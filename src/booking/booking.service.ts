import { randomBytes, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { fireAndForget, isExclusionViolation } from '../common/utils';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database, DbExecutor } from '../database/drizzle.types';
import { type Booking, bookings } from '../database/schema';
import { AvailabilityService } from './availability.service';
import { BookingNotifier } from './booking-notifier.service';
import { BOOKING_POLICY } from './booking-policy';
import { createCancelToken, hashCancelToken } from './cancel-token';
import { computeFreeSlots, overlapsBooking } from './compute-free-slots';
import type { CreateBookingDto } from './dto/create-booking.dto';
import { videoRoomUrl } from './video-room-url';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SLOT_MS = BOOKING_POLICY.slotMinutes * MINUTE_MS;

export type SlotsResponse = {
  timeZone: typeof BOOKING_POLICY.timeZone;
  slots: { startsAt: string; endsAt: string }[];
};

export type BookingConfirmation = {
  id: string;
  startsAt: string;
  endsAt: string;
  format: Booking['format'];
  videoUrl: string | null;
};

export type CancellationPreview = {
  startsAt: string;
  endsAt: string;
  format: Booking['format'];
  status: Booking['status'];
  cancellable: boolean;
};

/** Rendez-vous vu par l'admin : coordonnées en clair, instants ISO, jamais l'empreinte du jeton. */
export type AdminBooking = {
  id: string;
  startsAt: string;
  endsAt: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string;
  format: Booking['format'];
  videoUrl: string | null;
  status: Booking['status'];
  cancelledAt: string | null;
  cancelledBy: Booking['cancelledBy'];
  cancelReason: string | null;
  reminderSentAt: string | null;
  createdAt: string;
};

export type BookingScope = 'upcoming' | 'past';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly availability: AvailabilityService,
    private readonly config: AppConfigService,
    private readonly notifier: BookingNotifier,
  ) {}

  /** Créneaux libres de toute la fenêtre réservable, sans aucune donnée personnelle. */
  async getSlots(): Promise<SlotsResponse> {
    const { slots } = await this.freeSlots(this.db, new Date());
    return {
      timeZone: BOOKING_POLICY.timeZone,
      slots: slots.map(({ startsAt, endsAt }) => ({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })),
    };
  }

  /**
   * Réserve un créneau du calcul. Les créations sont sérialisées par un verrou consultatif de
   * transaction : plafond par email et battement sont recalculés sous verrou ; la contrainte
   * `booking_no_overlap` reste le dernier recours (ADR-0026).
   */
  async create(dto: CreateBookingDto): Promise<BookingConfirmation> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(startsAt.getTime() + SLOT_MS);
    const videoUrl =
      dto.format === 'video'
        ? videoRoomUrl(this.config.bookingVideoUrlBase, randomBytes(16))
        : null;

    if (dto.website) {
      // Champ piège rempli : même réponse qu'une réservation, rien de lu ni d'écrit.
      this.logger.warn('Booking honeypot filled: request dropped');
      return toConfirmation({
        id: randomUUID(),
        startsAt,
        endsAt,
        format: dto.format,
        videoUrl,
      });
    }

    const { row, token } = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('booking:create'))`,
      );
      const now = new Date();
      await this.assertBelowEmailLimit(tx, dto.email, now);
      await this.assertSlotFree(tx, now, startsAt, endsAt);

      const { token, hash } = createCancelToken();
      try {
        const [inserted] = await tx
          .insert(bookings)
          .values({
            startsAt,
            endsAt,
            name: dto.name,
            email: dto.email,
            phone: dto.format === 'phone' ? (dto.phone ?? null) : null,
            company: dto.company || null,
            message: dto.message,
            format: dto.format,
            videoUrl,
            cancelTokenHash: hash,
          })
          .returning();
        return { row: inserted, token };
      } catch (err) {
        if (isExclusionViolation(err, 'booking_no_overlap')) throw slotTaken();
        throw err;
      }
    });

    // Après le commit : un SMTP en panne ne fait pas échouer la réservation (visible dans l'admin).
    fireAndForget(
      this.notifier.bookingConfirmed(row, token),
      this.logger,
      `Failed to send booking confirmation mails for ${row.id}`,
    );
    return toConfirmation(row);
  }

  /** Aperçu du rendez-vous désigné par le jeton du lien d'annulation, sans donnée personnelle. */
  async previewCancellation(token: string): Promise<CancellationPreview> {
    const row = await this.findByCancelToken(token);
    return {
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      format: row.format,
      status: row.status,
      cancellable:
        row.status === 'confirmed' && Date.now() < row.startsAt.getTime(),
    };
  }

  /**
   * Annulation par le visiteur, idempotente : un rendez-vous déjà annulé (même passé) répond
   * `cancelled` sans écriture ni email ; seule la mise à jour gagnante prévient les deux parties.
   */
  async cancelByVisitor(token: string): Promise<{ status: 'cancelled' }> {
    const row = await this.findByCancelToken(token);
    if (row.status === 'cancelled') return { status: 'cancelled' };

    const now = new Date();
    assertNotStarted(row, now);

    const [cancelled] = await this.db
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: now, cancelledBy: 'visitor' })
      .where(and(eq(bookings.id, row.id), eq(bookings.status, 'confirmed')))
      .returning();
    if (cancelled) {
      fireAndForget(
        this.notifier.bookingCancelled(cancelled),
        this.logger,
        `Failed to send booking cancellation mails for ${cancelled.id}`,
      );
    }
    return { status: 'cancelled' };
  }

  /** `upcoming` : fin après maintenant, croissant ; `past` : le reste, décroissant ; les deux statuts. */
  async listBookings(scope: BookingScope): Promise<AdminBooking[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(bookings)
      .where(
        scope === 'upcoming'
          ? gt(bookings.endsAt, now)
          : lte(bookings.endsAt, now),
      )
      .orderBy(
        scope === 'upcoming' ? asc(bookings.startsAt) : desc(bookings.startsAt),
      );
    return rows.map(toAdminBooking);
  }

  async countUpcoming(): Promise<{ count: number }> {
    const [{ count: upcoming }] = await this.db
      .select({ count: count() })
      .from(bookings)
      .where(
        and(eq(bookings.status, 'confirmed'), gt(bookings.endsAt, new Date())),
      );
    return { count: upcoming };
  }

  /**
   * Annulation par le propriétaire, idempotente comme celle du visiteur : un rendez-vous déjà
   * annulé est rendu tel quel (motif non écrasé) ; seule la mise à jour gagnante prévient les deux
   * parties.
   */
  async cancelByOwner(id: string, reason?: string): Promise<AdminBooking> {
    const [row] = await this.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, id));
    if (!row) throw bookingNotFound();
    if (row.status === 'cancelled') return toAdminBooking(row);

    const now = new Date();
    assertNotStarted(row, now);

    const [cancelled] = await this.db
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: 'owner',
        cancelReason: reason || null,
      })
      .where(and(eq(bookings.id, id), eq(bookings.status, 'confirmed')))
      .returning();
    if (!cancelled) {
      // Course perdue (annulation visiteur concurrente) : on rend l'état gagnant, sans email.
      const [current] = await this.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, id));
      return toAdminBooking(current);
    }
    fireAndForget(
      this.notifier.bookingCancelled(cancelled),
      this.logger,
      `Failed to send booking cancellation mails for ${cancelled.id}`,
    );
    return toAdminBooking(cancelled);
  }

  /** Recherche par empreinte : le jeton en clair n'est ni stocké ni passé en paramètre SQL. */
  private async findByCancelToken(token: string): Promise<Booking> {
    const [row] = await this.db
      .select()
      .from(bookings)
      .where(eq(bookings.cancelTokenHash, hashCancelToken(token)));
    if (!row) throw bookingNotFound();
    return row;
  }

  private async assertBelowEmailLimit(
    tx: DbExecutor,
    email: string,
    now: Date,
  ): Promise<void> {
    const [{ count: upcoming }] = await tx
      .select({ count: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          gt(bookings.endsAt, now),
          sql`lower(${bookings.email}) = lower(${email})`,
        ),
      );
    if (upcoming >= BOOKING_POLICY.maxUpcomingPerEmail) {
      throw new UnprocessableEntityException({
        error: 'booking_limit_reached',
        message: `Vous avez déjà ${BOOKING_POLICY.maxUpcomingPerEmail} rendez-vous à venir.`,
      });
    }
  }

  /** 409 si un rendez-vous confirmé occupe le créneau (battement compris), 422 s'il n'est pas proposé. */
  private async assertSlotFree(
    tx: DbExecutor,
    now: Date,
    startsAt: Date,
    endsAt: Date,
  ): Promise<void> {
    const { slots, confirmed } = await this.freeSlots(tx, now);
    if (slots.some((slot) => slot.startsAt.getTime() === startsAt.getTime())) {
      return;
    }
    if (
      confirmed.some((booking) => overlapsBooking(startsAt, endsAt, booking))
    ) {
      throw slotTaken();
    }
    throw new UnprocessableEntityException({
      error: 'slot_unavailable',
      message: 'Ce créneau n’est pas proposé.',
    });
  }

  private async freeSlots(executor: DbExecutor, now: Date) {
    const [rules, closures, confirmed] = await Promise.all([
      this.availability.listRules(executor),
      this.availability.listClosures(executor),
      this.confirmedBookingsAround(executor, now),
    ]);
    const slots = computeFreeSlots({
      now,
      rules,
      closures,
      bookings: confirmed,
    });
    return { slots, confirmed };
  }

  /** Rendez-vous confirmés qui peuvent, battement compris, toucher un créneau de la fenêtre. */
  private confirmedBookingsAround(executor: DbExecutor, now: Date) {
    const { maxAdvanceDays, slotMinutes, bufferMinutes } = BOOKING_POLICY;
    const windowEnd = new Date(
      now.getTime() +
        maxAdvanceDays * DAY_MS +
        (slotMinutes + bufferMinutes) * MINUTE_MS,
    );
    return executor
      .select({
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        status: bookings.status,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          gt(bookings.endsAt, now),
          lt(bookings.startsAt, windowEnd),
        ),
      );
  }
}

const slotTaken = () =>
  new ConflictException({
    error: 'slot_taken',
    message: 'Ce créneau vient d’être réservé.',
  });

const bookingNotFound = () =>
  new NotFoundException({
    error: 'booking_not_found',
    message: 'Rendez-vous introuvable.',
  });

/** Un rendez-vous commencé (ou passé) ne s'annule plus, par aucune des parties. */
const assertNotStarted = (row: Pick<Booking, 'startsAt'>, now: Date): void => {
  if (now.getTime() >= row.startsAt.getTime()) {
    throw new ConflictException({
      error: 'cancel_too_late',
      message: 'Le rendez-vous a déjà commencé.',
    });
  }
};

const toConfirmation = (
  row: Pick<Booking, 'id' | 'startsAt' | 'endsAt' | 'format' | 'videoUrl'>,
): BookingConfirmation => ({
  id: row.id,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  format: row.format,
  videoUrl: row.videoUrl,
});

const toAdminBooking = (row: Booking): AdminBooking => ({
  id: row.id,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  name: row.name,
  email: row.email,
  phone: row.phone,
  company: row.company,
  message: row.message,
  format: row.format,
  videoUrl: row.videoUrl,
  status: row.status,
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
  cancelledBy: row.cancelledBy,
  cancelReason: row.cancelReason,
  reminderSentAt: row.reminderSentAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

import { randomBytes, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import { isExclusionViolation } from '../common/utils';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database, DbExecutor } from '../database/drizzle.types';
import { type Booking, bookings } from '../database/schema';
import { AvailabilityService } from './availability.service';
import { BOOKING_POLICY } from './booking-policy';
import { createCancelToken } from './cancel-token';
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

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly availability: AvailabilityService,
    private readonly config: AppConfigService,
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

    const row = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('booking:create'))`,
      );
      const now = new Date();
      await this.assertBelowEmailLimit(tx, dto.email, now);
      await this.assertSlotFree(tx, now, startsAt, endsAt);

      const { hash } = createCancelToken();
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
        return inserted;
      } catch (err) {
        if (isExclusionViolation(err, 'booking_no_overlap')) throw slotTaken();
        throw err;
      }
    });

    return toConfirmation(row);
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

const toConfirmation = (
  row: Pick<Booking, 'id' | 'startsAt' | 'endsAt' | 'format' | 'videoUrl'>,
): BookingConfirmation => ({
  id: row.id,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  format: row.format,
  videoUrl: row.videoUrl,
});

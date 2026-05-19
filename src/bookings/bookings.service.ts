// noinspection SqlNoDataSourceInspection,SqlResolve
import { resolve } from 'node:path';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  bookings,
  disabledDates,
  type Booking,
  type DisabledDate,
} from '../database/schema/bookings';
import { AppConfigService } from '../config/app-config.service';
import { MailerService } from '../mailer/mailer.service';
import { loadTemplate, renderTemplate } from '../mailer/mailer.utils';
import { fireAndForget, isUniqueViolation } from '../common/utils';
import {
  type PaginatedResult,
  type PaginationParams,
} from '../common/pagination';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateDisabledDateDto } from './dto/create-disabled-date.dto';
import { parseTimeToMinutes } from './bookings.utils';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  private static readonly TEMPLATES_DIR = resolve(__dirname, 'mail-templates');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly cfg: AppConfigService,
    private readonly mailer: MailerService,
  ) {}

  async create(dto: CreateBookingDto): Promise<Booking> {
    // 1. Check date is not disabled
    const disabled = await this.db
      .select({ id: disabledDates.id })
      .from(disabledDates)
      .where(eq(disabledDates.date, dto.date))
      .limit(1);
    if (disabled.length > 0) {
      throw new ConflictException(`Date ${dto.date} is disabled for bookings`);
    }

    // 2. Check no overlap with existing booking same date.
    // start_time is stored as "HH:MM" text; convert to minutes via SPLIT_PART
    // so the comparison runs as a single indexed query on `booking_date_idx`.
    const newStartMin = parseTimeToMinutes(dto.startTime);
    const newEndMin = newStartMin + dto.duration;
    const existingStartMin = sql<number>`(SPLIT_PART(${bookings.startTime}, ':', 1)::int * 60 + SPLIT_PART(${bookings.startTime}, ':', 2)::int)`;

    const overlapping = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.date, dto.date),
          sql`${existingStartMin} < ${newEndMin}`,
          sql`${existingStartMin} + ${bookings.duration} > ${newStartMin}`,
        ),
      )
      .limit(1);
    if (overlapping.length > 0) {
      throw new ConflictException(
        `Time slot overlaps with an existing booking on ${dto.date}`,
      );
    }

    // 3. Insert + fire-and-forget mails
    const [row] = await this.db.insert(bookings).values(dto).returning();
    fireAndForget(
      this.sendNotificationMails(row),
      this.logger,
      `Failed to send booking mails for ${row.id}`,
    );
    return row;
  }

  async findAll(params: PaginationParams): Promise<PaginatedResult<Booking>> {
    const [totalRow, data] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)::int` }).from(bookings),
      this.db
        .select()
        .from(bookings)
        .orderBy(desc(bookings.createdAt))
        .limit(params.limit)
        .offset(params.offset),
    ]);
    return {
      data,
      total: totalRow[0]?.count ?? 0,
      page: params.page,
      limit: params.limit,
    };
  }

  findSlotsByMonth(
    month: string,
  ): Promise<Pick<Booking, 'date' | 'startTime' | 'duration'>[]> {
    const startDate = `${month}-01`;
    const [year, monthNum] = month.split('-').map(Number);
    const nextMonth =
      monthNum === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(monthNum + 1).padStart(2, '0')}-01`;
    return this.db
      .select({
        date: bookings.date,
        startTime: bookings.startTime,
        duration: bookings.duration,
      })
      .from(bookings)
      .where(and(gte(bookings.date, startDate), lt(bookings.date, nextMonth)));
  }

  async remove(id: string): Promise<void> {
    const rows = await this.db
      .delete(bookings)
      .where(eq(bookings.id, id))
      .returning({ id: bookings.id });
    if (rows.length === 0)
      throw new NotFoundException(`Booking ${id} not found`);
  }

  // Disabled dates ----------------------------------------------------------

  findAllDisabledDates(): Promise<DisabledDate[]> {
    return this.db
      .select()
      .from(disabledDates)
      .orderBy(asc(disabledDates.date));
  }

  async createDisabledDate(dto: CreateDisabledDateDto): Promise<DisabledDate> {
    try {
      const [row] = await this.db.insert(disabledDates).values(dto).returning();
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'date')) {
        throw new ConflictException(`Date ${dto.date} already disabled`);
      }
      throw err;
    }
  }

  async removeDisabledDate(id: string): Promise<void> {
    const rows = await this.db
      .delete(disabledDates)
      .where(eq(disabledDates.id, id))
      .returning({ id: disabledDates.id });
    if (rows.length === 0)
      throw new NotFoundException(`Disabled date ${id} not found`);
  }

  // Helper privé non-bloquant
  private async sendNotificationMails(booking: Booking): Promise<void> {
    const adminTpl = loadTemplate(
      resolve(BookingsService.TEMPLATES_DIR, 'booking-notification.html'),
    );
    const visitorTpl = loadTemplate(
      resolve(BookingsService.TEMPLATES_DIR, 'booking-confirmation.html'),
    );
    const variables = {
      name: booking.name,
      email: booking.email,
      phone: booking.phone,
      date: booking.date,
      startTime: booking.startTime,
      duration: String(booking.duration),
      subject: booking.subject,
      message: booking.message,
    };
    await Promise.all([
      this.mailer.sendMail({
        to: this.cfg.contactEmail,
        subject: `Nouvelle demande de rendez-vous: ${booking.subject}`,
        html: renderTemplate(adminTpl, variables),
      }),
      this.mailer.sendMail({
        to: booking.email,
        subject: 'Confirmation de votre demande de rendez-vous',
        html: renderTemplate(visitorTpl, variables),
      }),
    ]);
  }
}

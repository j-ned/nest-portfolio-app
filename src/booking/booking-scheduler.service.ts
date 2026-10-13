import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { bookings } from '../database/schema';
import { BookingNotifier } from './booking-notifier.service';

const REMINDERS_CRON = '*/15 * * * *';
const PURGE_CRON = '30 3 * * *';

/**
 * Tâches planifiées des rendez-vous (ADR 0026) : rappel la veille et purge à six mois.
 * Le rappel est réclamé par une seule mise à jour atomique avant l'envoi : deux passages qui se
 * chevauchent ne rappellent jamais deux fois, et un envoi raté est journalisé, pas rejoué.
 */
@Injectable()
export class BookingScheduler {
  private readonly logger = new Logger(BookingScheduler.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly notifier: BookingNotifier,
  ) {}

  @Sentry.SentryCron('booking-reminders', {
    schedule: { type: 'crontab', value: REMINDERS_CRON },
    timezone: 'UTC',
    checkinMargin: 5,
    maxRuntime: 5,
  })
  @Cron(REMINDERS_CRON, { timeZone: 'UTC' })
  async sendReminders(): Promise<void> {
    // Réservé moins de 30 h avant le début : la confirmation tient lieu de rappel.
    const claimed = await this.db
      .update(bookings)
      .set({ reminderSentAt: sql`now()` })
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          isNull(bookings.reminderSentAt),
          sql`${bookings.startsAt} > now()`,
          sql`${bookings.startsAt} <= now() + interval '24 hours'`,
          sql`${bookings.createdAt} <= ${bookings.startsAt} - interval '30 hours'`,
        ),
      )
      .returning();

    await Promise.all(
      claimed.map((row) =>
        this.notifier.bookingReminder(row).catch(() => {
          // Ni le message de l'erreur ni la ligne : une erreur SMTP cite souvent le destinataire.
          this.logger.error(`Booking reminder failed for booking ${row.id}`);
        }),
      ),
    );
  }

  @Sentry.SentryCron('booking-purge', {
    schedule: { type: 'crontab', value: PURGE_CRON },
    timezone: 'UTC',
    checkinMargin: 5,
    maxRuntime: 5,
  })
  @Cron(PURGE_CRON, { timeZone: 'UTC' })
  async purgeExpired(): Promise<void> {
    const deleted = await this.db
      .delete(bookings)
      .where(lt(bookings.endsAt, sql`now() - interval '6 months'`))
      .returning({ id: bookings.id });
    this.logger.log(
      `Purged ${deleted.length} bookings ended more than 6 months ago`,
    );
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, lt } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { bookings } from '../database/schema';
import { AvailabilityService } from './availability.service';
import { BOOKING_POLICY } from './booking-policy';
import { computeFreeSlots } from './compute-free-slots';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type SlotsResponse = {
  timeZone: typeof BOOKING_POLICY.timeZone;
  slots: { startsAt: string; endsAt: string }[];
};

@Injectable()
export class BookingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly availability: AvailabilityService,
  ) {}

  /** Créneaux libres de toute la fenêtre réservable, sans aucune donnée personnelle. */
  async getSlots(): Promise<SlotsResponse> {
    const now = new Date();
    const [rules, closures, confirmed] = await Promise.all([
      this.availability.listRules(),
      this.availability.listClosures(),
      this.confirmedBookingsAround(now),
    ]);
    const slots = computeFreeSlots({
      now,
      rules,
      closures,
      bookings: confirmed,
    });
    return {
      timeZone: BOOKING_POLICY.timeZone,
      slots: slots.map(({ startsAt, endsAt }) => ({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })),
    };
  }

  /** Rendez-vous confirmés qui peuvent, battement compris, toucher un créneau de la fenêtre. */
  private confirmedBookingsAround(now: Date) {
    const { maxAdvanceDays, slotMinutes, bufferMinutes } = BOOKING_POLICY;
    const windowEnd = new Date(
      now.getTime() +
        maxAdvanceDays * DAY_MS +
        (slotMinutes + bufferMinutes) * MINUTE_MS,
    );
    return this.db
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

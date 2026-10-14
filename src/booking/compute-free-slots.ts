import type {
  AvailabilityClosure,
  AvailabilityRule,
  Booking,
} from '../database/schema';
import { BOOKING_POLICY } from './booking-policy';
import { addDays, toParisDate } from './paris-time';
import {
  closedReason,
  type DayOverrideKind,
  templateSlotsOn,
} from './resolve-day';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type FreeSlot = { readonly startsAt: Date; readonly endsAt: Date };

export type FreeSlotsInput = {
  readonly now: Date;
  readonly rules: readonly Pick<
    AvailabilityRule,
    'weekday' | 'startMinute' | 'endMinute'
  >[];
  readonly closures: readonly Pick<
    AvailabilityClosure,
    'startsOn' | 'endsOn'
  >[];
  readonly bookings: readonly Pick<Booking, 'startsAt' | 'endsAt' | 'status'>[];
  readonly overrides: ReadonlyMap<string, DayOverrideKind>;
  readonly closePublicHolidays: boolean;
};

type BookingSpan = Pick<Booking, 'startsAt' | 'endsAt'>;

/** Le créneau `[start, end)` touche le rendez-vous, battement de `bufferMinutes` compris de part et d'autre. */
export function overlapsBooking(
  start: Date,
  end: Date,
  booking: BookingSpan,
): boolean {
  const buffer = BOOKING_POLICY.bufferMinutes * MINUTE_MS;
  return (
    booking.startsAt.getTime() - buffer < end.getTime() &&
    start.getTime() < booking.endsAt.getTime() + buffer
  );
}

/**
 * Créneaux libres de la fenêtre réservable (ADR-0026 §3), triés et uniques. Pur : `now` est un
 * paramètre. Un créneau part d'un jour de Paris ouvert (`closedReason` nul : ni fermeture, ni
 * exception fermée, ni férié sous interrupteur actif, ADR-0027), suit la semaine type, respecte
 * préavis et horizon, et tombe hors battement d'un rendez-vous confirmé.
 */
export function computeFreeSlots({
  now,
  rules,
  closures,
  bookings,
  overrides,
  closePublicHolidays,
}: FreeSlotsInput): readonly FreeSlot[] {
  const { slotMinutes } = BOOKING_POLICY;
  const earliest = now.getTime() + BOOKING_POLICY.minNoticeHours * HOUR_MS;
  const latest = now.getTime() + BOOKING_POLICY.maxAdvanceDays * DAY_MS;
  const blocking = bookings.filter((booking) => booking.status === 'confirmed');
  const today = toParisDate(now);
  const ctx = { today, closures, overrides, closePublicHolidays };
  const free = new Map<number, FreeSlot>();

  const lastDate = toParisDate(new Date(latest));
  for (let date = today; date <= lastDate; date = addDays(date, 1)) {
    if (closedReason(date, ctx)) continue;

    for (const startsAt of templateSlotsOn(date, rules)) {
      const start = startsAt.getTime();
      if (start < earliest || start > latest) continue;
      const endsAt = new Date(start + slotMinutes * MINUTE_MS);
      const taken = blocking.some((booking) =>
        overlapsBooking(startsAt, endsAt, booking),
      );
      if (!taken) free.set(start, { startsAt, endsAt });
    }
  }

  return [...free.values()].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
}

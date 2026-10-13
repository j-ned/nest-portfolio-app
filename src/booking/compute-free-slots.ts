import type {
  AvailabilityClosure,
  AvailabilityRule,
  Booking,
} from '../database/schema';
import { BOOKING_POLICY } from './booking-policy';
import { isoWeekday, parisWallTimeToUtc, toParisDate } from './paris-time';

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
};

const nextDate = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/**
 * Créneaux libres de la fenêtre réservable (ADR-0026 §3), triés et uniques. Pur : `now` est un
 * paramètre. Un créneau part d'une plage du jour de Paris, au pas de `stepMinutes`, finit dans la
 * plage, respecte préavis et horizon, tombe hors fermeture et hors battement d'un rendez-vous
 * confirmé.
 */
export function computeFreeSlots({
  now,
  rules,
  closures,
  bookings,
}: FreeSlotsInput): readonly FreeSlot[] {
  const { slotMinutes, stepMinutes, bufferMinutes } = BOOKING_POLICY;
  const earliest = now.getTime() + BOOKING_POLICY.minNoticeHours * HOUR_MS;
  const latest = now.getTime() + BOOKING_POLICY.maxAdvanceDays * DAY_MS;
  const buffer = bufferMinutes * MINUTE_MS;
  const blocking = bookings.filter((booking) => booking.status === 'confirmed');
  const free = new Map<number, FreeSlot>();

  const lastDate = toParisDate(new Date(latest));
  for (let date = toParisDate(now); date <= lastDate; date = nextDate(date)) {
    const closed = closures.some(
      (closure) => closure.startsOn <= date && date <= closure.endsOn,
    );
    if (closed) continue;

    const weekday = isoWeekday(date);
    for (const rule of rules.filter((r) => r.weekday === weekday)) {
      for (
        let minute = rule.startMinute;
        minute + slotMinutes <= rule.endMinute;
        minute += stepMinutes
      ) {
        const startsAt = parisWallTimeToUtc(date, minute);
        if (!startsAt) continue;
        const start = startsAt.getTime();
        if (start < earliest || start > latest) continue;
        const end = start + slotMinutes * MINUTE_MS;
        const taken = blocking.some(
          (booking) =>
            booking.startsAt.getTime() - buffer < end &&
            start < booking.endsAt.getTime() + buffer,
        );
        if (!taken) free.set(start, { startsAt, endsAt: new Date(end) });
      }
    }
  }

  return [...free.values()].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
}

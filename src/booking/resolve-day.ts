import type { AvailabilityClosure, AvailabilityRule } from '../database/schema';
import { BOOKING_POLICY } from './booking-policy';
import { publicHolidayName } from './french-public-holidays';
import { isoWeekday, parisWallTimeToUtc } from './paris-time';

export type DayOverrideKind = 'open' | 'closed';

export type DayClosedReason = 'past' | 'closed-period' | 'closed' | 'holiday';

export type DayContext = {
  readonly today: string;
  readonly closures: readonly Pick<
    AvailabilityClosure,
    'startsOn' | 'endsOn'
  >[];
  readonly overrides: ReadonlyMap<string, DayOverrideKind>;
  readonly closePublicHolidays: boolean;
};

/**
 * Raison de fermeture d'une date de Paris, `null` si la semaine type s'applique (ADR-0027). Ordre :
 * passé, fermeture par période, exception par date, férié sous interrupteur actif.
 */
export function closedReason(
  date: string,
  ctx: DayContext,
): DayClosedReason | null {
  // Dates `YYYY-MM-DD` : l'ordre lexical est l'ordre chronologique.
  if (date < ctx.today) return 'past';
  if (
    ctx.closures.some(
      (closure) => closure.startsOn <= date && date <= closure.endsOn,
    )
  ) {
    return 'closed-period';
  }
  const override = ctx.overrides.get(date);
  if (override) return override === 'closed' ? 'closed' : null;
  return ctx.closePublicHolidays && publicHolidayName(date) !== null
    ? 'holiday'
    : null;
}

/**
 * Créneaux de la semaine type ce jour-là, dans l'ordre des plages fournies : pas de `stepMinutes`,
 * fin dans la plage, heure inexistante du passage à l'heure d'été sautée. Ni préavis, ni horizon,
 * ni rendez-vous, ni fermeture.
 */
export function templateSlotsOn(
  date: string,
  rules: readonly Pick<
    AvailabilityRule,
    'weekday' | 'startMinute' | 'endMinute'
  >[],
): readonly Date[] {
  const { slotMinutes, stepMinutes } = BOOKING_POLICY;
  const weekday = isoWeekday(date);
  const slots: Date[] = [];
  for (const rule of rules.filter((r) => r.weekday === weekday)) {
    for (
      let minute = rule.startMinute;
      minute + slotMinutes <= rule.endMinute;
      minute += stepMinutes
    ) {
      const startsAt = parisWallTimeToUtc(date, minute);
      if (startsAt) slots.push(startsAt);
    }
  }
  return slots;
}

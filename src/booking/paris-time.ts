import { BOOKING_POLICY } from './booking-policy';

/**
 * Heure murale de Paris ⇄ instant UTC, par `Intl` seul (ADR-0026 §2). Indépendant du fuseau du
 * processus : aucune méthode locale de `Date` n'est utilisée.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const PARIS_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: BOOKING_POLICY.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const PARIS_LONG_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: BOOKING_POLICY.timeZone,
  dateStyle: 'full',
});

const PARIS_SHORT_TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: BOOKING_POLICY.timeZone,
  timeStyle: 'short',
});

type ParisWallTime = { readonly date: string; readonly minuteOfDay: number };

function toParisWallTime(instant: Date): ParisWallTime {
  const parts = Object.fromEntries(
    PARIS_PARTS.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Date de Paris (`YYYY-MM-DD`) d'un instant. */
export const toParisDate = (instant: Date): string =>
  toParisWallTime(instant).date;

/**
 * Instant d'une heure murale de Paris. Essaie les deux décalages de Paris (+02:00 puis +01:00,
 * donc le plus tôt d'abord) et garde le premier qui redonne la même heure murale : heure répétée
 * d'octobre → la plus tôt ; heure inexistante de mars → `null`.
 */
export function parisWallTimeToUtc(
  date: string,
  minuteOfDay: number,
): Date | null {
  const [year, month, day] = date.split('-').map(Number);
  const asUtc = Date.UTC(year, month - 1, day) + minuteOfDay * MINUTE_MS;
  for (const offsetHours of [2, 1]) {
    const candidate = new Date(asUtc - offsetHours * HOUR_MS);
    const wall = toParisWallTime(candidate);
    if (wall.date === date && wall.minuteOfDay === minuteOfDay) {
      return candidate;
    }
  }
  return null;
}

/** Date calendaire décalée de `days` jours (négatif accepté), sans fuseau : arithmétique UTC. */
export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** Jour ISO d'une date calendaire (lundi = 1, dimanche = 7). */
export function isoWeekday(date: string): number {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Libellé des emails : « lundi 19 octobre 2026 à 09:00 ». */
export const formatParisLong = (instant: Date): string =>
  `${PARIS_LONG_DATE.format(instant)} à ${PARIS_SHORT_TIME.format(instant)}`;

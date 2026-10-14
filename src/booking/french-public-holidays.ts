import { addDays } from './paris-time';

/**
 * Jours fériés de métropole (Code du travail, art. L3133-1), calculés sans dépendance (ADR-0027) :
 * les dimanches de Pâques et de Pentecôte n'y figurent pas.
 */

const FIXED_HOLIDAYS: readonly (readonly [string, string])[] = [
  ['01-01', 'Jour de l’an'],
  ['05-01', 'Fête du Travail'],
  ['05-08', 'Victoire 1945'],
  ['07-14', 'Fête nationale'],
  ['08-15', 'Assomption'],
  ['11-01', 'Toussaint'],
  ['11-11', 'Armistice 1918'],
  ['12-25', 'Noël'],
];

/** Décalage en jours depuis le dimanche de Pâques. */
const EASTER_HOLIDAYS: readonly (readonly [number, string])[] = [
  [1, 'Lundi de Pâques'],
  [39, 'Ascension'],
  [50, 'Lundi de Pentecôte'],
];

/** Dimanche de Pâques grégorien (algorithme de Meeus/Jones/Butcher), `YYYY-MM-DD`. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

const holidaysByYear = new Map<number, ReadonlyMap<string, string>>();

/**
 * Fériés de l'année, clés `YYYY-MM-DD`, mémoïsés par année. Deux fériés le même jour donnent un
 * seul férié nommé d'après les deux, le fixe d'abord.
 */
export function frenchPublicHolidays(
  year: number,
): ReadonlyMap<string, string> {
  const known = holidaysByYear.get(year);
  if (known) return known;

  const holidays = new Map<string, string>(
    FIXED_HOLIDAYS.map(([monthDay, name]) => [`${year}-${monthDay}`, name]),
  );
  const easter = easterSunday(year);
  for (const [offset, name] of EASTER_HOLIDAYS) {
    const date = addDays(easter, offset);
    const fixed = holidays.get(date);
    holidays.set(date, fixed ? `${fixed} et ${name}` : name);
  }
  holidaysByYear.set(year, holidays);
  return holidays;
}

/** Nom du férié de cette date, ou `null`. */
export const publicHolidayName = (date: string): string | null =>
  frenchPublicHolidays(Number(date.slice(0, 4))).get(date) ?? null;

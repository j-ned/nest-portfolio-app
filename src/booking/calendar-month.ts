/**
 * Mois que l'admin peut parcourir après le mois de Paris courant (navigation du calendrier, pas une
 * règle de réservation : `BOOKING_POLICY` n'en dépend pas).
 */
export const CALENDAR_MONTHS_AHEAD = 12;

/** Mois `YYYY-MM` d'une date `YYYY-MM-DD`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Mois `YYYY-MM` décalé de `months` (négatif accepté) ; `Date.UTC` reporte les débordements d'année. */
export function addMonths(month: string, months: number): string {
  const [year, monthIndex] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthIndex - 1 + months, 1))
    .toISOString()
    .slice(0, 7);
}

/** Dates `YYYY-MM-DD` du mois, croissantes ; calendaires, donc insensibles aux changements d'heure. */
export function daysOfMonth(month: string): readonly string[] {
  const [year, monthIndex] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
}

/** Dernier jour modifiable : dernier jour du mois de `today` + `CALENDAR_MONTHS_AHEAD`. */
export function lastAllowedDay(today: string): string {
  const days = daysOfMonth(addMonths(monthOf(today), CALENDAR_MONTHS_AHEAD));
  return days[days.length - 1];
}

/**
 * Mois que l'admin peut parcourir après le mois de Paris courant (navigation du calendrier, pas une
 * règle de réservation : `BOOKING_POLICY` n'en dépend pas).
 */
export const CALENDAR_MONTHS_AHEAD = 12;

/** Dernier jour modifiable : dernier jour du mois de `today` + `CALENDAR_MONTHS_AHEAD`. */
export function lastAllowedDay(today: string): string {
  const [year, month] = today.split('-').map(Number);
  // Jour 0 du mois suivant = dernier jour du mois visé ; `Date.UTC` reporte les mois > 12.
  return new Date(Date.UTC(year, month + CALENDAR_MONTHS_AHEAD, 0))
    .toISOString()
    .slice(0, 10);
}

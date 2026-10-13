export type BookingPolicy = {
  readonly timeZone: 'Europe/Paris';
  readonly slotMinutes: number;
  readonly stepMinutes: number;
  readonly bufferMinutes: number;
  readonly minNoticeHours: number;
  readonly maxAdvanceDays: number;
  readonly maxUpcomingPerEmail: number;
  readonly reminderLeadHours: number;
  readonly reminderMinCreatedAheadHours: number;
  readonly retentionMonths: number;
};

/** Règles de la prise de rendez-vous (spec 024, Exigence 5 ; ADR-0026 §6). Pas de réglage admin. */
export const BOOKING_POLICY = {
  timeZone: 'Europe/Paris',
  slotMinutes: 30,
  stepMinutes: 30,
  bufferMinutes: 15,
  minNoticeHours: 24,
  maxAdvanceDays: 21,
  maxUpcomingPerEmail: 2,
  reminderLeadHours: 24,
  reminderMinCreatedAheadHours: 30,
  retentionMonths: 6,
} as const satisfies BookingPolicy;

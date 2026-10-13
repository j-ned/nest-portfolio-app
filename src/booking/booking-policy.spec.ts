import { BOOKING_POLICY } from './booking-policy';

describe('BOOKING_POLICY', () => {
  it('Given les règles écrites de la prise de rendez-vous, Then la politique les reprend exactement', () => {
    expect(BOOKING_POLICY).toEqual({
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
    });
  });
});

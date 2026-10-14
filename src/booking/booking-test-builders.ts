import type {
  AvailabilityClosure,
  AvailabilityOverride,
  AvailabilityRule,
  Booking,
} from '../database/schema';
import type { AdminBooking } from './booking.service';

const CREATED_AT = new Date('2026-10-01T08:00:00Z');

export const anAvailabilityRule = (
  overrides: Partial<AvailabilityRule> = {},
): AvailabilityRule => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  weekday: 1,
  startMinute: 540,
  endMinute: 600,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  ...overrides,
});

export const anAvailabilityClosure = (
  overrides: Partial<AvailabilityClosure> = {},
): AvailabilityClosure => ({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  startsOn: '2026-12-24',
  endsOn: '2026-12-26',
  reason: null,
  createdAt: CREATED_AT,
  ...overrides,
});

export const anAvailabilityOverride = (
  overrides: Partial<AvailabilityOverride> = {},
): AvailabilityOverride => ({
  day: '2026-11-12',
  kind: 'closed',
  createdAt: CREATED_AT,
  ...overrides,
});

export const aBooking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  startsAt: new Date('2026-11-04T09:00:00Z'),
  endsAt: new Date('2026-11-04T09:30:00Z'),
  name: 'Visiteur Test',
  email: 'visiteur@example.com',
  phone: null,
  company: null,
  message: 'Un projet Angular à cadrer.',
  format: 'video',
  videoUrl: 'https://meet.jit.si/nedellec-abcdefgh12345678',
  status: 'confirmed',
  cancelTokenHash: 'a'.repeat(64),
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  reminderSentAt: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  ...overrides,
});

export const anAdminBooking = (
  overrides: Partial<AdminBooking> = {},
): AdminBooking => ({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  startsAt: '2026-11-04T09:00:00.000Z',
  endsAt: '2026-11-04T09:30:00.000Z',
  name: 'Visiteur Test',
  email: 'visiteur@example.com',
  phone: null,
  company: null,
  message: 'Un projet Angular à cadrer.',
  format: 'video',
  videoUrl: 'https://meet.jit.si/nedellec-abcdefgh12345678',
  status: 'confirmed',
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  reminderSentAt: null,
  createdAt: CREATED_AT.toISOString(),
  ...overrides,
});

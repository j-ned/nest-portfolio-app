import type { CreateBookingDto } from './dto/create-booking.dto';

export const aBookingRequest = (
  overrides: Partial<CreateBookingDto> = {},
): CreateBookingDto => ({
  startsAt: '2026-11-04T10:00:00.000Z',
  name: 'Camille Martin',
  email: 'camille@example.com',
  format: 'video',
  message: 'Refonte de notre application Angular.',
  ...overrides,
});

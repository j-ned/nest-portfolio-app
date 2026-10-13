import { Test, type TestingModule } from '@nestjs/testing';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { AvailabilityService } from './availability.service';
import { BookingService } from './booking.service';
import {
  aBooking,
  anAvailabilityClosure,
  anAvailabilityRule,
} from './booking-test-builders';

const WEDNESDAY_9_TO_12 = anAvailabilityRule({
  weekday: 3,
  startMinute: 540,
  endMinute: 720,
});
const LATER_WEDNESDAYS_CLOSED = anAvailabilityClosure({
  startsOn: '2026-11-05',
  endsOn: '2026-11-30',
});

describe('BookingService.getSlots', () => {
  let service: BookingService;
  let db: ReturnType<typeof createMockDb>;
  let availability: {
    listRules: jest.Mock;
    listClosures: jest.Mock;
  };

  beforeEach(async () => {
    db = createMockDb();
    availability = {
      listRules: jest.fn().mockResolvedValue([WEDNESDAY_9_TO_12]),
      listClosures: jest.fn().mockResolvedValue([LATER_WEDNESDAYS_CLOSED]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: DRIZZLE, useValue: db },
        { provide: AvailabilityService, useValue: availability },
      ],
    }).compile();
    service = module.get(BookingService);
    jest.useFakeTimers().setSystemTime(new Date('2026-11-02T08:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Given un rendez-vous confirmé mercredi 10:00, When getSlots, Then les créneaux libres en ISO UTC, battement déduit', async () => {
    db.where.mockResolvedValueOnce([
      aBooking({
        startsAt: new Date('2026-11-04T09:00:00Z'),
        endsAt: new Date('2026-11-04T09:30:00Z'),
      }),
    ]);

    await expect(service.getSlots()).resolves.toEqual({
      timeZone: 'Europe/Paris',
      slots: [
        {
          startsAt: '2026-11-04T08:00:00.000Z',
          endsAt: '2026-11-04T08:30:00.000Z',
        },
        {
          startsAt: '2026-11-04T10:00:00.000Z',
          endsAt: '2026-11-04T10:30:00.000Z',
        },
        {
          startsAt: '2026-11-04T10:30:00.000Z',
          endsAt: '2026-11-04T11:00:00.000Z',
        },
      ],
    });
  });

  it('Given un rendez-vous annulé lu en base, When getSlots, Then il ne retire aucun créneau', async () => {
    db.where.mockResolvedValueOnce([
      aBooking({
        startsAt: new Date('2026-11-04T09:00:00Z'),
        endsAt: new Date('2026-11-04T09:30:00Z'),
        status: 'cancelled',
        cancelledAt: new Date('2026-11-01T10:00:00Z'),
        cancelledBy: 'visitor',
      }),
    ]);

    const { slots } = await service.getSlots();

    expect(slots.map((slot) => slot.startsAt)).toEqual([
      '2026-11-04T08:00:00.000Z',
      '2026-11-04T08:30:00.000Z',
      '2026-11-04T09:00:00.000Z',
      '2026-11-04T09:30:00.000Z',
      '2026-11-04T10:00:00.000Z',
      '2026-11-04T10:30:00.000Z',
    ]);
  });

  it('Given l’horloge avance au mardi 10:00, When getSlots, Then le préavis de 24 h part de l’heure courante', async () => {
    jest.setSystemTime(new Date('2026-11-03T09:00:00Z'));
    db.where.mockResolvedValueOnce([]);

    const { slots } = await service.getSlots();

    expect(slots.map((slot) => slot.startsAt)).toEqual([
      '2026-11-04T09:00:00.000Z',
      '2026-11-04T09:30:00.000Z',
      '2026-11-04T10:00:00.000Z',
      '2026-11-04T10:30:00.000Z',
    ]);
  });

  it('Given des rendez-vous avec coordonnées, When getSlots, Then la réponse publique ne contient aucune donnée personnelle', async () => {
    db.where.mockResolvedValueOnce([
      aBooking({
        startsAt: new Date('2026-11-04T09:00:00Z'),
        endsAt: new Date('2026-11-04T09:30:00Z'),
        name: 'Camille Martin',
        email: 'camille@example.com',
        phone: '+33 6 12 34 56 78',
        company: 'Société Exemple',
        message: 'Refonte de notre application.',
      }),
    ]);

    const result = await service.getSlots();
    const serialized = JSON.stringify(result);

    for (const personal of [
      'Camille Martin',
      'camille@example.com',
      '+33 6 12 34 56 78',
      'Société Exemple',
      'Refonte de notre application.',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ]) {
      expect(serialized).not.toContain(personal);
    }
  });

  it('Given aucune plage, When getSlots, Then une liste vide avec le fuseau', async () => {
    availability.listRules.mockResolvedValueOnce([]);
    db.where.mockResolvedValueOnce([]);

    await expect(service.getSlots()).resolves.toEqual({
      timeZone: 'Europe/Paris',
      slots: [],
    });
  });
});

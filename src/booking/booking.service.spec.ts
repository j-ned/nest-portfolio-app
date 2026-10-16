import { createHash } from 'node:crypto';
import {
  ConflictException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { bookings } from '../database/schema';
import { createMockDb } from '../database/test-utils';
import { AvailabilityService } from './availability.service';
import { BookingService } from './booking.service';
import { aBookingRequest } from './booking-request-test-builder';
import {
  aBooking,
  anAvailabilityClosure,
  anAvailabilityRule,
} from './booking-test-builders';
import { hashCancelToken } from './cancel-token';

const aNotifierDouble = () => ({
  bookingConfirmed: jest.fn().mockResolvedValue(undefined),
  bookingCancelled: jest.fn().mockResolvedValue(undefined),
});

const providingNotifier =
  (notifier: ReturnType<typeof aNotifierDouble>) => (token: unknown) => {
    if (typeof token === 'function' && token.name === 'BookingNotifier') {
      return notifier;
    }
    throw new Error(
      `Unexpected dependency: ${typeof token === 'function' ? token.name : String(token)}`,
    );
  };

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
    readClosePublicHolidays: jest.Mock;
    listOverrides: jest.Mock;
  };

  beforeEach(async () => {
    db = createMockDb();
    availability = {
      listRules: jest.fn().mockResolvedValue([WEDNESDAY_9_TO_12]),
      listClosures: jest.fn().mockResolvedValue([LATER_WEDNESDAYS_CLOSED]),
      readClosePublicHolidays: jest.fn().mockResolvedValue(false),
      listOverrides: jest.fn().mockResolvedValue(new Map()),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: DRIZZLE, useValue: db },
        { provide: AvailabilityService, useValue: availability },
        {
          provide: AppConfigService,
          useValue: { bookingVideoUrlBase: 'https://meet.jit.si' },
        },
      ],
    })
      .useMocker(providingNotifier(aNotifierDouble()))
      .compile();
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

  it.each([
    ['actif', true, ['2026-11-04', '2026-11-18']],
    ['inactif', false, ['2026-11-04', '2026-11-11', '2026-11-18']],
  ])(
    'Given des plages le mercredi, aucune fermeture et le réglage des fériés %s (%s), When getSlots, Then les jours proposés sont %j',
    async (_case, closePublicHolidays, expected) => {
      availability.listClosures.mockResolvedValueOnce([]);
      availability.readClosePublicHolidays.mockResolvedValueOnce(
        closePublicHolidays,
      );
      db.where.mockResolvedValueOnce([]);

      const { slots } = await service.getSlots();

      expect([
        ...new Set(slots.map((slot) => slot.startsAt.slice(0, 10))),
      ]).toEqual(expected);
    },
  );

  it('Given getSlots, Then le réglage des fériés est lu sur la connexion partagée', async () => {
    db.where.mockResolvedValueOnce([]);

    await service.getSlots();

    expect(availability.readClosePublicHolidays).toHaveBeenCalledTimes(1);
    expect(availability.readClosePublicHolidays).toHaveBeenCalledWith(db);
  });

  it.each([
    [
      'le réglage des fériés inactif et le 11/11 fermé à la main',
      false,
      'closed',
      ['2026-11-04', '2026-11-18'],
    ],
    [
      'le réglage des fériés actif et le 11/11 rouvert',
      true,
      'open',
      ['2026-11-04', '2026-11-11', '2026-11-18'],
    ],
  ] as const)(
    'Given des plages le mercredi, aucune fermeture et %s (réglage %s, exception %s), When getSlots, Then les jours proposés sont %j',
    async (_case, closePublicHolidays, kind, expected) => {
      availability.listClosures.mockResolvedValueOnce([]);
      availability.readClosePublicHolidays.mockResolvedValueOnce(
        closePublicHolidays,
      );
      availability.listOverrides.mockResolvedValueOnce(
        new Map([['2026-11-11', kind]]),
      );
      db.where.mockResolvedValueOnce([]);

      const { slots } = await service.getSlots();

      expect([
        ...new Set(slots.map((slot) => slot.startsAt.slice(0, 10))),
      ]).toEqual(expected);
    },
  );

  it.each([
    ['2026-11-02T08:00:00Z', '2026-11-02', '2026-11-23'],
    ['2026-11-02T23:30:00Z', '2026-11-03', '2026-11-24'],
  ])(
    'Given il est %s, When getSlots, Then les exceptions sont lues une fois, sur la connexion partagée, du %s au %s (dates de Paris)',
    async (now, from, to) => {
      jest.setSystemTime(new Date(now));
      db.where.mockResolvedValueOnce([]);

      await service.getSlots();

      expect(availability.listOverrides).toHaveBeenCalledTimes(1);
      expect(availability.listOverrides).toHaveBeenCalledWith(db, from, to);
    },
  );
});

const CONFIRMED_AT_10_PARIS = aBooking({
  startsAt: new Date('2026-11-04T09:00:00Z'),
  endsAt: new Date('2026-11-04T09:30:00Z'),
});
const VIDEO_ROOM = /^https:\/\/visio\.example\.test\/nedellec-[a-z0-9]{16}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const render = (fragment: unknown) =>
  new PgDialect({ casing: 'snake_case' }).sqlToQuery(fragment as SQL);

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (err: unknown) => err,
  );

const wrappedPgError = (code: string, constraint: string): Error => {
  const err = new Error('Failed query: insert into "booking" …');
  (err as unknown as Record<string, unknown>).cause = {
    code,
    constraint_name: constraint,
  };
  return err;
};

const sha256Hex = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

const firstCall = (mock: jest.Mock): number =>
  Math.min(...mock.mock.invocationCallOrder);

describe('BookingService.create', () => {
  let service: BookingService;
  let db: ReturnType<typeof createMockDb>;
  let tx: ReturnType<typeof createMockDb>;
  let availability: {
    listRules: jest.Mock;
    listClosures: jest.Mock;
    readClosePublicHolidays: jest.Mock;
    listOverrides: jest.Mock;
  };
  let notifier: ReturnType<typeof aNotifierDouble>;
  let logged: jest.SpyInstance[];
  let warned: jest.SpyInstance;

  const givenUpcomingForEmail = (count: number) =>
    tx.where.mockResolvedValueOnce([{ count }]);
  const givenConfirmed = (rows: ReturnType<typeof aBooking>[]) =>
    tx.where.mockResolvedValueOnce(rows);
  const givenInserted = (row: ReturnType<typeof aBooking>) =>
    tx.returning.mockResolvedValueOnce([row]);
  const insertedValues = (): Record<string, unknown> =>
    (tx.values.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
  const loggedText = () =>
    logged
      .flatMap((spy) => spy.mock.calls as unknown[][])
      .map((args) => JSON.stringify(args))
      .join('\n');

  beforeEach(async () => {
    db = createMockDb();
    tx = createMockDb();
    db.transaction.mockImplementation((fn: (t: unknown) => unknown) =>
      Promise.resolve(fn(tx)),
    );
    availability = {
      listRules: jest.fn().mockResolvedValue([WEDNESDAY_9_TO_12]),
      listClosures: jest.fn().mockResolvedValue([LATER_WEDNESDAYS_CLOSED]),
      readClosePublicHolidays: jest.fn().mockResolvedValue(false),
      listOverrides: jest.fn().mockResolvedValue(new Map()),
    };
    notifier = aNotifierDouble();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: DRIZZLE, useValue: db },
        { provide: AvailabilityService, useValue: availability },
        {
          provide: AppConfigService,
          useValue: { bookingVideoUrlBase: 'https://visio.example.test/' },
        },
      ],
    })
      .useMocker(providingNotifier(notifier))
      .compile();
    service = module.get(BookingService);
    logged = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => {}),
    );
    warned = logged[1];
    jest.useFakeTimers().setSystemTime(new Date('2026-11-02T08:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('créneau libre', () => {
    it('Given un créneau du calcul, When le visiteur réserve en visio, Then la confirmation exacte du contrat', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([CONFIRMED_AT_10_PARIS]);
      givenInserted(
        aBooking({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          startsAt: new Date('2026-11-04T10:00:00Z'),
          endsAt: new Date('2026-11-04T10:30:00Z'),
          format: 'video',
          videoUrl: 'https://visio.example.test/nedellec-0123456789abcdef',
        }),
      );

      await expect(service.create(aBookingRequest())).resolves.toEqual({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        startsAt: '2026-11-04T10:00:00.000Z',
        endsAt: '2026-11-04T10:30:00.000Z',
        format: 'video',
        videoUrl: 'https://visio.example.test/nedellec-0123456789abcdef',
      });
    });

    it('Given une réservation en visio, When elle est insérée, Then fin à +30 min, salle générée sur la base configurée, empreinte du jeton, aucun téléphone', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(aBookingRequest({ phone: '+33 6 12 34 56 78' }));

      expect(tx.insert).toHaveBeenCalledWith(bookings);
      expect(tx.values).toHaveBeenCalledTimes(1);
      expect(insertedValues()).toEqual(
        expect.objectContaining({
          startsAt: new Date('2026-11-04T10:00:00Z'),
          endsAt: new Date('2026-11-04T10:30:00Z'),
          name: 'Camille Martin',
          email: 'camille@example.com',
          phone: null,
          company: null,
          message: 'Refonte de notre application Angular.',
          format: 'video',
          videoUrl: expect.stringMatching(VIDEO_ROOM) as unknown,
          cancelTokenHash: expect.stringMatching(SHA256_HEX) as unknown,
        }),
      );
      expect(insertedValues()).not.toHaveProperty('website');
    });

    it('Given une réservation par téléphone avec entreprise, When elle est insérée, Then le numéro et l’entreprise sont gardés, sans salle de visio', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking({ format: 'phone', videoUrl: null }));

      await service.create(
        aBookingRequest({
          format: 'phone',
          phone: '+33 6 12 34 56 78',
          company: 'Société Exemple',
        }),
      );

      expect(insertedValues()).toEqual(
        expect.objectContaining({
          format: 'phone',
          phone: '+33 6 12 34 56 78',
          company: 'Société Exemple',
          videoUrl: null,
        }),
      );
    });

    it('Given deux réservations successives, When elles sont insérées, Then deux salles et deux empreintes différentes', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(aBookingRequest());
      await service.create(
        aBookingRequest({ startsAt: '2026-11-04T08:00:00.000Z' }),
      );

      const [first, second] = tx.values.mock.calls.map(
        ([values]) => values as Record<string, unknown>,
      );
      expect(second.videoUrl).not.toBe(first.videoUrl);
      expect(second.cancelTokenHash).not.toBe(first.cancelTokenHash);
    });

    it('Given un instant exprimé avec décalage +01:00, When il désigne un créneau libre, Then il est comparé et stocké comme instant', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(
        aBookingRequest({ startsAt: '2026-11-04T11:00:00+01:00' }),
      );

      expect(insertedValues()).toEqual(
        expect.objectContaining({
          startsAt: new Date('2026-11-04T10:00:00Z'),
          endsAt: new Date('2026-11-04T10:30:00Z'),
        }),
      );
    });

    it('Given une création réussie, Then le jeton en clair n’apparaît dans aucun log', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(aBookingRequest());

      const hash = insertedValues().cancelTokenHash;
      const text = loggedText();
      const windows = Array.from(
        { length: Math.max(0, text.length - 42) },
        (_, i) => text.slice(i, i + 43),
      );
      expect(windows.filter((w) => sha256Hex(w) === hash)).toEqual([]);
    });
  });

  describe('verrou', () => {
    it('Given une création, Then le verrou consultatif de transaction est pris avant toute lecture, dans la transaction', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(aBookingRequest());

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.execute).toHaveBeenCalledTimes(1);
      const lock = render((tx.execute.mock.calls as unknown[][])[0][0]);
      expect(lock.sql).toMatch(
        /^select pg_advisory_xact_lock\(hashtext\(('booking:create'|\$1)\)\)$/i,
      );
      expect([lock.sql, ...lock.params].join(' ')).toContain('booking:create');
      const lockedAt = firstCall(tx.execute);
      expect(lockedAt).toBeLessThan(firstCall(tx.select));
      expect(lockedAt).toBeLessThan(firstCall(availability.listRules));
      expect(lockedAt).toBeLessThan(firstCall(availability.listClosures));
    });

    it('Given une création, Then le réglage des fériés est lu par la transaction, après le verrou', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(aBookingRequest());

      expect(availability.readClosePublicHolidays).toHaveBeenCalledTimes(1);
      expect(availability.readClosePublicHolidays).toHaveBeenCalledWith(tx);
      expect(firstCall(tx.execute)).toBeLessThan(
        firstCall(availability.readClosePublicHolidays),
      );
    });

    it('Given une création, Then les exceptions de la fenêtre sont lues par la transaction, après le verrou', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(aBookingRequest());

      expect(availability.listOverrides).toHaveBeenCalledTimes(1);
      expect(availability.listOverrides).toHaveBeenCalledWith(
        tx,
        '2026-11-02',
        '2026-11-23',
      );
      expect(firstCall(tx.execute)).toBeLessThan(
        firstCall(availability.listOverrides),
      );
    });

    it('Given une création, Then lectures de rendez-vous et insertion passent par la transaction, jamais par la connexion partagée', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(aBookingRequest());

      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe('plafond par email', () => {
    it.each([2, 3])(
      'Given %i rendez-vous à venir pour cet email, When il réserve, Then 422 booking_limit_reached sans insertion',
      async (count) => {
        givenUpcomingForEmail(count);
        givenConfirmed([]);

        const err = await rejectionOf(service.create(aBookingRequest()));

        expect(err).toBeInstanceOf(UnprocessableEntityException);
        expect((err as UnprocessableEntityException).getResponse()).toEqual(
          expect.objectContaining({ error: 'booking_limit_reached' }),
        );
        expect(tx.insert).not.toHaveBeenCalled();
      },
    );

    it.each([0, 1])(
      'Given %i rendez-vous à venir pour cet email, When il réserve, Then la réservation est insérée',
      async (count) => {
        givenUpcomingForEmail(count);
        givenConfirmed([]);
        givenInserted(aBooking());

        await service.create(aBookingRequest());

        expect(tx.values).toHaveBeenCalledTimes(1);
      },
    );

    it('Given le plafond atteint et un créneau indisponible, Then le plafond l’emporte', async () => {
      givenUpcomingForEmail(2);
      givenConfirmed([]);

      const err = await rejectionOf(
        service.create(
          aBookingRequest({ startsAt: '2026-11-03T09:00:00.000Z' }),
        ),
      );

      expect((err as UnprocessableEntityException).getResponse()).toEqual(
        expect.objectContaining({ error: 'booking_limit_reached' }),
      );
    });
  });

  describe('créneau refusé', () => {
    it.each([
      ['même instant que le rendez-vous', '2026-11-04T09:00:00.000Z'],
      ['battement avant (09:30 de Paris)', '2026-11-04T08:30:00.000Z'],
      ['battement après (10:30 de Paris)', '2026-11-04T09:30:00.000Z'],
      ['hors grille, en conflit', '2026-11-04T09:15:00.000Z'],
    ])(
      'Given un rendez-vous confirmé à 10:00 de Paris et une demande %s, Then 409 slot_taken sans insertion',
      async (_case, startsAt) => {
        givenUpcomingForEmail(0);
        givenConfirmed([CONFIRMED_AT_10_PARIS]);

        const err = await rejectionOf(
          service.create(aBookingRequest({ startsAt })),
        );

        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).getResponse()).toEqual(
          expect.objectContaining({ error: 'slot_taken' }),
        );
        expect(tx.insert).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['hors grille, sans conflit', '2026-11-04T10:15:00.000Z'],
      ['avant la plage du jour', '2026-11-04T07:30:00.000Z'],
      ['un jour sans plage', '2026-11-03T09:00:00.000Z'],
      ['un jour fermé', '2026-11-11T09:00:00.000Z'],
    ])(
      'Given une demande %s, Then 422 slot_unavailable sans insertion',
      async (_case, startsAt) => {
        givenUpcomingForEmail(0);
        givenConfirmed([CONFIRMED_AT_10_PARIS]);

        const err = await rejectionOf(
          service.create(aBookingRequest({ startsAt })),
        );

        expect(err).toBeInstanceOf(UnprocessableEntityException);
        expect((err as UnprocessableEntityException).getResponse()).toEqual(
          expect.objectContaining({ error: 'slot_unavailable' }),
        );
        expect(tx.insert).not.toHaveBeenCalled();
      },
    );

    it('Given le réglage des fériés actif et aucune fermeture, When le visiteur demande le 11 novembre à 10:00 de Paris, Then 422 slot_unavailable sans insertion', async () => {
      availability.listClosures.mockResolvedValueOnce([]);
      availability.readClosePublicHolidays.mockResolvedValueOnce(true);
      givenUpcomingForEmail(0);
      givenConfirmed([]);

      const err = await rejectionOf(
        service.create(
          aBookingRequest({ startsAt: '2026-11-11T09:00:00.000Z' }),
        ),
      );

      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toEqual(
        expect.objectContaining({ error: 'slot_unavailable' }),
      );
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it('Given le réglage des fériés inactif et aucune fermeture, When le visiteur demande le 11 novembre à 10:00 de Paris, Then le rendez-vous est inséré', async () => {
      availability.listClosures.mockResolvedValueOnce([]);
      availability.readClosePublicHolidays.mockResolvedValueOnce(false);
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(
        aBooking({
          startsAt: new Date('2026-11-11T09:00:00Z'),
          endsAt: new Date('2026-11-11T09:30:00Z'),
        }),
      );

      await service.create(
        aBookingRequest({ startsAt: '2026-11-11T09:00:00.000Z' }),
      );

      expect(insertedValues()).toEqual(
        expect.objectContaining({
          startsAt: new Date('2026-11-11T09:00:00Z'),
          endsAt: new Date('2026-11-11T09:30:00Z'),
        }),
      );
    });

    it('Given le 04/11 fermé à la main, When le visiteur demande le 04/11 à 09:00 de Paris, Then 422 slot_unavailable sans insertion', async () => {
      availability.listOverrides.mockResolvedValueOnce(
        new Map([['2026-11-04', 'closed']]),
      );
      givenUpcomingForEmail(0);
      givenConfirmed([]);

      const err = await rejectionOf(
        service.create(
          aBookingRequest({ startsAt: '2026-11-04T08:00:00.000Z' }),
        ),
      );

      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toEqual(
        expect.objectContaining({ error: 'slot_unavailable' }),
      );
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it('Given le réglage des fériés actif et le 11/11 rouvert, When le visiteur demande le 11/11 à 10:00 de Paris, Then le rendez-vous est inséré', async () => {
      availability.listClosures.mockResolvedValueOnce([]);
      availability.readClosePublicHolidays.mockResolvedValueOnce(true);
      availability.listOverrides.mockResolvedValueOnce(
        new Map([['2026-11-11', 'open']]),
      );
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(
        aBooking({
          startsAt: new Date('2026-11-11T09:00:00Z'),
          endsAt: new Date('2026-11-11T09:30:00Z'),
        }),
      );

      await expect(
        service.create(
          aBookingRequest({ startsAt: '2026-11-11T09:00:00.000Z' }),
        ),
      ).resolves.toEqual(
        expect.objectContaining({ startsAt: '2026-11-11T09:00:00.000Z' }),
      );

      expect(insertedValues()).toEqual(
        expect.objectContaining({
          startsAt: new Date('2026-11-11T09:00:00Z'),
          endsAt: new Date('2026-11-11T09:30:00Z'),
        }),
      );
    });

    it('Given l’horloge à 23 h 30 d’un créneau de la plage, When le visiteur le demande, Then 422 slot_unavailable (préavis)', async () => {
      jest.setSystemTime(new Date('2026-11-03T08:30:00Z'));
      givenUpcomingForEmail(0);
      givenConfirmed([CONFIRMED_AT_10_PARIS]);

      const err = await rejectionOf(
        service.create(
          aBookingRequest({ startsAt: '2026-11-04T08:00:00.000Z' }),
        ),
      );

      expect((err as UnprocessableEntityException).getResponse()).toEqual(
        expect.objectContaining({ error: 'slot_unavailable' }),
      );
    });

    it('Given une insertion refusée par booking_no_overlap (23P01), Then 409 slot_taken', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      tx.returning.mockRejectedValueOnce(
        wrappedPgError('23P01', 'booking_no_overlap'),
      );

      const err = await rejectionOf(service.create(aBookingRequest()));

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ error: 'slot_taken' }),
      );
    });

    it('Given une autre erreur d’insertion, Then elle remonte telle quelle', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      const failure = wrappedPgError(
        '23505',
        'booking_cancel_token_hash_unique',
      );
      tx.returning.mockRejectedValueOnce(failure);

      await expect(service.create(aBookingRequest())).rejects.toBe(failure);
    });
  });

  describe('champ piège', () => {
    const BOT = aBookingRequest({
      website: 'https://spam.test',
      startsAt: '2026-11-03T09:00:00.000Z',
      phone: '+33 6 12 34 56 78',
      company: 'Société Exemple',
    });

    it('Given le champ piège rempli, Then une confirmation de même forme, même sur un créneau indisponible', async () => {
      const result = await service.create(BOT);

      expect(Object.keys(result).sort()).toEqual([
        'endsAt',
        'format',
        'id',
        'startsAt',
        'videoUrl',
      ]);
      expect(result).toEqual({
        id: expect.stringMatching(UUID) as unknown,
        startsAt: '2026-11-03T09:00:00.000Z',
        endsAt: '2026-11-03T09:30:00.000Z',
        format: 'video',
        videoUrl: expect.stringMatching(VIDEO_ROOM) as unknown,
      });
    });

    it('Given le champ piège rempli en format téléphone, Then la confirmation n’a pas de salle', async () => {
      await expect(
        service.create({ ...BOT, format: 'phone' }),
      ).resolves.toEqual(
        expect.objectContaining({ format: 'phone', videoUrl: null }),
      );
    });

    it('Given le champ piège rempli, Then ni verrou, ni lecture, ni écriture', async () => {
      await service.create(BOT);

      expect(tx.execute).not.toHaveBeenCalled();
      expect(tx.select).not.toHaveBeenCalled();
      expect(tx.insert).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(availability.listRules).not.toHaveBeenCalled();
    });

    it('Given le champ piège rempli, Then un seul avertissement, sans aucune donnée saisie', async () => {
      await service.create(BOT);

      expect(warned).toHaveBeenCalledTimes(1);
      const text = loggedText();
      for (const personal of [
        'Camille Martin',
        'camille@example.com',
        '+33 6 12 34 56 78',
        'Société Exemple',
        'Refonte de notre application Angular.',
        'https://spam.test',
      ]) {
        expect(text).not.toContain(personal);
      }
    });

    it('Given le champ piège présent mais vide, When le visiteur réserve, Then la réservation suit son cours', async () => {
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(aBookingRequest({ website: '' }));

      expect(tx.values).toHaveBeenCalledTimes(1);
    });
  });

  describe('notification', () => {
    const flushFireAndForget = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };

    it('Given une réservation insérée, Then le notifier reçoit la ligne insérée et le jeton en clair dont l’empreinte est stockée', async () => {
      const inserted = aBooking({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(inserted);

      await service.create(aBookingRequest());
      await flushFireAndForget();

      expect(notifier.bookingConfirmed).toHaveBeenCalledTimes(1);
      const [row, token] = notifier.bookingConfirmed.mock.calls[0] as [
        unknown,
        string,
      ];
      expect(row).toBe(inserted);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(hashCancelToken(token)).toBe(insertedValues().cancelTokenHash);
    });

    it('Given une réservation, Then le notifier est appelé après la fin de la transaction, jamais dedans', async () => {
      let notifiedInsideTransaction: boolean | undefined;
      db.transaction.mockImplementation(
        async (fn: (t: unknown) => Promise<unknown>) => {
          const result = await fn(tx);
          notifiedInsideTransaction =
            notifier.bookingConfirmed.mock.calls.length > 0;
          return result;
        },
      );
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking());

      await service.create(aBookingRequest());
      await flushFireAndForget();

      expect(notifiedInsideTransaction).toBe(false);
      expect(notifier.bookingConfirmed).toHaveBeenCalledTimes(1);
    });

    it('Given un envoi qui ne se termine jamais, Then la confirmation est rendue sans l’attendre', async () => {
      notifier.bookingConfirmed.mockReturnValueOnce(new Promise(() => {}));
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }));

      await expect(service.create(aBookingRequest())).resolves.toEqual(
        expect.objectContaining({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      );
      expect(notifier.bookingConfirmed).toHaveBeenCalledTimes(1);
    });

    it('Given un envoi en échec, Then la réservation reste confirmée et l’échec est journalisé avec l’id, sans le jeton', async () => {
      notifier.bookingConfirmed.mockRejectedValueOnce(new Error('SMTP down'));
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(aBooking({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }));

      await expect(service.create(aBookingRequest())).resolves.toEqual(
        expect.objectContaining({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      );
      await flushFireAndForget();

      const errored = logged[2];
      expect(errored).toHaveBeenCalledTimes(1);
      expect(errored).toHaveBeenCalledWith(
        expect.stringContaining('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
        expect.anything(),
      );
      const [, token] = notifier.bookingConfirmed.mock.calls[0] as [
        unknown,
        string,
      ];
      expect(loggedText()).not.toContain(token);
    });

    it('Given le champ piège puis une vraie réservation, Then une seule notification, celle de la vraie', async () => {
      const real = aBooking({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
      givenUpcomingForEmail(0);
      givenConfirmed([]);
      givenInserted(real);

      await service.create(aBookingRequest({ website: 'https://spam.test' }));
      await service.create(aBookingRequest());
      await flushFireAndForget();

      expect(notifier.bookingConfirmed).toHaveBeenCalledTimes(1);
      expect(notifier.bookingConfirmed).toHaveBeenCalledWith(
        real,
        expect.any(String),
      );
    });

    it.each([
      ['plafond atteint', () => givenUpcomingForEmail(2)],
      [
        'créneau pris',
        () => {
          givenUpcomingForEmail(0);
          givenConfirmed([
            aBooking({
              startsAt: new Date('2026-11-04T10:00:00Z'),
              endsAt: new Date('2026-11-04T10:30:00Z'),
            }),
          ]);
        },
      ],
      [
        'insertion refusée par la contrainte',
        () => {
          givenUpcomingForEmail(0);
          givenConfirmed([]);
          tx.returning.mockRejectedValueOnce(
            wrappedPgError('23P01', 'booking_no_overlap'),
          );
        },
      ],
    ])(
      'Given %s, When la création échoue, Then aucune notification',
      async (_case, arrange) => {
        arrange();

        await rejectionOf(service.create(aBookingRequest()));
        await flushFireAndForget();

        expect(notifier.bookingConfirmed).not.toHaveBeenCalled();
      },
    );
  });
});

describe('BookingService, annulation par le visiteur', () => {
  const TOKEN = 'Qm9va2luZ0NhbmNlbFRva2VuX0Zvcl9UZXN0c18wMTI';
  const NOW = new Date('2026-11-02T08:00:00Z');
  const UPCOMING = aBooking({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    startsAt: new Date('2026-11-04T10:00:00Z'),
    endsAt: new Date('2026-11-04T10:30:00Z'),
    format: 'phone',
    videoUrl: null,
    phone: '+33 6 12 34 56 78',
    cancelTokenHash: hashCancelToken(TOKEN),
  });
  const CANCELLED = aBooking({
    ...UPCOMING,
    status: 'cancelled',
    cancelledAt: new Date('2026-11-01T09:00:00Z'),
    cancelledBy: 'visitor',
  });

  let service: BookingService;
  let db: ReturnType<typeof createMockDb>;
  let notifier: ReturnType<typeof aNotifierDouble>;
  let logged: jest.SpyInstance[];

  const givenFound = (rows: ReturnType<typeof aBooking>[]) =>
    db.where.mockResolvedValueOnce(rows);
  const givenUpdated = (rows: ReturnType<typeof aBooking>[]) =>
    db.returning.mockResolvedValueOnce(rows);
  const loggedText = () =>
    logged
      .flatMap((spy) => spy.mock.calls as unknown[][])
      .map((args) => JSON.stringify(args))
      .join('\n');
  const flushFireAndForget = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const businessError = (err: unknown): unknown =>
    (err as { getResponse(): { error?: unknown } }).getResponse().error;

  beforeEach(async () => {
    db = createMockDb();
    notifier = aNotifierDouble();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: DRIZZLE, useValue: db },
        {
          provide: AvailabilityService,
          useValue: { listRules: jest.fn(), listClosures: jest.fn() },
        },
        {
          provide: AppConfigService,
          useValue: { bookingVideoUrlBase: 'https://meet.jit.si' },
        },
      ],
    })
      .useMocker(providingNotifier(notifier))
      .compile();
    service = module.get(BookingService);
    logged = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => {}),
    );
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('previewCancellation', () => {
    it('Given un jeton d’un rendez-vous à venir, Then l’aperçu exact du contrat, sans donnée personnelle', async () => {
      givenFound([UPCOMING]);

      await expect(service.previewCancellation(TOKEN)).resolves.toEqual({
        startsAt: '2026-11-04T10:00:00.000Z',
        endsAt: '2026-11-04T10:30:00.000Z',
        format: 'phone',
        status: 'confirmed',
        cancellable: true,
      });
    });

    it('Given un jeton, Then le rendez-vous est cherché par l’empreinte, jamais par le jeton en clair', async () => {
      givenFound([UPCOMING]);

      await service.previewCancellation(TOKEN);

      expect(db.from).toHaveBeenCalledWith(bookings);
      const lookup = render((db.where.mock.calls as unknown[][])[0][0]);
      expect(lookup.params).toContain(hashCancelToken(TOKEN));
      expect(lookup.params).not.toContain(TOKEN);
      expect(lookup.sql).toContain('"cancel_token_hash"');
    });

    it.each([
      ['un rendez-vous annulé', 'cancelled', false, CANCELLED, NOW],
      [
        'un rendez-vous qui commence à l’instant',
        'confirmed',
        false,
        UPCOMING,
        new Date('2026-11-04T10:00:00Z'),
      ],
      [
        'un rendez-vous commencé',
        'confirmed',
        false,
        UPCOMING,
        new Date('2026-11-04T10:10:00Z'),
      ],
      [
        'un rendez-vous qui commence dans 1 ms',
        'confirmed',
        true,
        UPCOMING,
        new Date('2026-11-04T09:59:59.999Z'),
      ],
    ] as const)(
      'Given %s, Then statut %s et annulable = %s',
      async (_case, status, cancellable, row, now) => {
        jest.setSystemTime(now);
        givenFound([row]);

        await expect(service.previewCancellation(TOKEN)).resolves.toEqual(
          expect.objectContaining({ status, cancellable }),
        );
      },
    );

    it('Given un jeton inconnu, Then 404 booking_not_found', async () => {
      givenFound([]);

      const err = await rejectionOf(service.previewCancellation(TOKEN));

      expect(err).toBeInstanceOf(NotFoundException);
      expect(businessError(err)).toBe('booking_not_found');
    });

    it('Given un aperçu, Then le jeton n’apparaît dans aucun log', async () => {
      givenFound([UPCOMING]);

      await service.previewCancellation(TOKEN);

      expect(loggedText()).not.toContain(TOKEN);
    });
  });

  describe('cancelByVisitor', () => {
    it('Given un rendez-vous à venir, Then il passe annulé par le visiteur à l’heure courante et la réponse est { status: cancelled }', async () => {
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED]);

      await expect(service.cancelByVisitor(TOKEN)).resolves.toEqual({
        status: 'cancelled',
      });
      expect(db.update).toHaveBeenCalledWith(bookings);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'cancelled',
          cancelledAt: NOW,
          cancelledBy: 'visitor',
        }),
      );
    });

    it('Given un rendez-vous à venir, Then la mise à jour ne vise que ce rendez-vous tant qu’il est confirmé', async () => {
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED]);

      await service.cancelByVisitor(TOKEN);

      const lookup = render((db.where.mock.calls as unknown[][])[0][0]);
      expect(lookup.params).toContain(hashCancelToken(TOKEN));
      const guard = render((db.where.mock.calls as unknown[][])[1][0]);
      expect(guard.params).toEqual(
        expect.arrayContaining([UPCOMING.id, 'confirmed']),
      );
    });

    it('Given une annulation réussie, Then le notifier reçoit la ligne annulée, après la mise à jour', async () => {
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED]);

      await service.cancelByVisitor(TOKEN);
      await flushFireAndForget();

      expect(notifier.bookingCancelled).toHaveBeenCalledTimes(1);
      expect(notifier.bookingCancelled).toHaveBeenCalledWith(CANCELLED);
      expect(
        notifier.bookingCancelled.mock.invocationCallOrder[0],
      ).toBeGreaterThan(db.returning.mock.invocationCallOrder[0]);
    });

    it('Given un envoi qui ne se termine jamais, Then la réponse est rendue sans l’attendre', async () => {
      notifier.bookingCancelled.mockReturnValueOnce(new Promise(() => {}));
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED]);

      await expect(service.cancelByVisitor(TOKEN)).resolves.toEqual({
        status: 'cancelled',
      });
      expect(notifier.bookingCancelled).toHaveBeenCalledTimes(1);
    });

    it('Given un envoi en échec, Then l’annulation tient et l’échec est journalisé avec l’id, sans le jeton', async () => {
      notifier.bookingCancelled.mockRejectedValueOnce(new Error('SMTP down'));
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED]);

      await expect(service.cancelByVisitor(TOKEN)).resolves.toEqual({
        status: 'cancelled',
      });
      await flushFireAndForget();

      expect(logged[2]).toHaveBeenCalledWith(
        expect.stringContaining(UPCOMING.id),
        expect.anything(),
      );
      expect(loggedText()).not.toContain(TOKEN);
    });

    it('Given un rendez-vous déjà annulé, Then { status: cancelled } sans mise à jour ni email (idempotent)', async () => {
      givenFound([CANCELLED]);

      await expect(service.cancelByVisitor(TOKEN)).resolves.toEqual({
        status: 'cancelled',
      });
      await flushFireAndForget();

      expect(db.update).not.toHaveBeenCalled();
      expect(notifier.bookingCancelled).not.toHaveBeenCalled();
    });

    it('Given un rendez-vous déjà annulé et passé, Then { status: cancelled } plutôt que cancel_too_late', async () => {
      jest.setSystemTime(new Date('2026-11-05T08:00:00Z'));
      givenFound([CANCELLED]);

      await expect(service.cancelByVisitor(TOKEN)).resolves.toEqual({
        status: 'cancelled',
      });
    });

    it('Given une annulation concurrente gagnée par un autre appel, Then { status: cancelled } sans second email', async () => {
      givenFound([UPCOMING]);
      givenUpdated([]);

      await expect(service.cancelByVisitor(TOKEN)).resolves.toEqual({
        status: 'cancelled',
      });
      await flushFireAndForget();

      expect(notifier.bookingCancelled).not.toHaveBeenCalled();
    });

    it.each([
      ['qui commence à l’instant', new Date('2026-11-04T10:00:00Z')],
      ['commencé depuis 10 min', new Date('2026-11-04T10:10:00Z')],
      ['terminé', new Date('2026-11-05T08:00:00Z')],
    ])(
      'Given un rendez-vous confirmé %s, Then 409 cancel_too_late sans mise à jour ni email',
      async (_case, now) => {
        jest.setSystemTime(now);
        givenFound([UPCOMING]);

        const err = await rejectionOf(service.cancelByVisitor(TOKEN));
        await flushFireAndForget();

        expect(err).toBeInstanceOf(ConflictException);
        expect(businessError(err)).toBe('cancel_too_late');
        expect(db.update).not.toHaveBeenCalled();
        expect(notifier.bookingCancelled).not.toHaveBeenCalled();
      },
    );

    it('Given un rendez-vous qui commence dans 1 ms, Then il est encore annulable', async () => {
      jest.setSystemTime(new Date('2026-11-04T09:59:59.999Z'));
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED]);

      await expect(service.cancelByVisitor(TOKEN)).resolves.toEqual({
        status: 'cancelled',
      });
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('Given un jeton inconnu, Then 404 booking_not_found sans mise à jour', async () => {
      givenFound([]);

      const err = await rejectionOf(service.cancelByVisitor(TOKEN));

      expect(err).toBeInstanceOf(NotFoundException);
      expect(businessError(err)).toBe('booking_not_found');
      expect(db.update).not.toHaveBeenCalled();
    });

    it('Given une annulation réussie, Then le jeton n’apparaît dans aucun log', async () => {
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED]);

      await service.cancelByVisitor(TOKEN);
      await flushFireAndForget();

      expect(loggedText()).not.toContain(TOKEN);
    });
  });
});

describe('BookingService, administration', () => {
  const NOW = new Date('2026-11-02T08:00:00Z');
  const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const UPCOMING = aBooking({
    id: ID,
    startsAt: new Date('2026-11-04T10:00:00Z'),
    endsAt: new Date('2026-11-04T10:30:00Z'),
    name: 'Camille Martin',
    email: 'camille@example.com',
    format: 'phone',
    videoUrl: null,
    phone: '+33 6 12 34 56 78',
    company: 'Société Exemple',
    message: 'Refonte de notre application Angular.',
  });
  const CANCELLED_BY_OWNER = aBooking({
    ...UPCOMING,
    status: 'cancelled',
    cancelledAt: NOW,
    cancelledBy: 'owner',
    cancelReason: 'Imprévu de mon côté.',
    updatedAt: NOW,
  });
  const CANCELLED_BY_VISITOR = aBooking({
    ...UPCOMING,
    status: 'cancelled',
    cancelledAt: new Date('2026-11-01T09:00:00Z'),
    cancelledBy: 'visitor',
  });

  let service: BookingService;
  let db: ReturnType<typeof createMockDb>;
  let notifier: ReturnType<typeof aNotifierDouble>;
  let logged: jest.SpyInstance[];

  const flushFireAndForget = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const businessError = (err: unknown): unknown =>
    (err as { getResponse(): { error?: unknown } }).getResponse().error;
  const givenFound = (rows: ReturnType<typeof aBooking>[]) =>
    db.where.mockResolvedValueOnce(rows);
  const givenUpdated = (rows: ReturnType<typeof aBooking>[]) =>
    db.returning.mockResolvedValueOnce(rows);

  beforeEach(async () => {
    db = createMockDb();
    notifier = aNotifierDouble();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: DRIZZLE, useValue: db },
        {
          provide: AvailabilityService,
          useValue: { listRules: jest.fn(), listClosures: jest.fn() },
        },
        {
          provide: AppConfigService,
          useValue: { bookingVideoUrlBase: 'https://meet.jit.si' },
        },
      ],
    })
      .useMocker(providingNotifier(notifier))
      .compile();
    service = module.get(BookingService);
    logged = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => {}),
    );
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('listBookings', () => {
    it('Given des rendez-vous lus en base, Then les lignes admin exactes : coordonnées et annulation en clair, instants ISO, jamais l’empreinte du jeton', async () => {
      db.orderBy.mockResolvedValueOnce([
        UPCOMING,
        aBooking({
          ...CANCELLED_BY_OWNER,
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          reminderSentAt: new Date('2026-11-03T10:00:00Z'),
        }),
      ]);

      await expect(service.listBookings('upcoming')).resolves.toEqual([
        {
          id: ID,
          startsAt: '2026-11-04T10:00:00.000Z',
          endsAt: '2026-11-04T10:30:00.000Z',
          name: 'Camille Martin',
          email: 'camille@example.com',
          phone: '+33 6 12 34 56 78',
          company: 'Société Exemple',
          message: 'Refonte de notre application Angular.',
          format: 'phone',
          videoUrl: null,
          status: 'confirmed',
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          reminderSentAt: null,
          createdAt: '2026-10-01T08:00:00.000Z',
        },
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          startsAt: '2026-11-04T10:00:00.000Z',
          endsAt: '2026-11-04T10:30:00.000Z',
          name: 'Camille Martin',
          email: 'camille@example.com',
          phone: '+33 6 12 34 56 78',
          company: 'Société Exemple',
          message: 'Refonte de notre application Angular.',
          format: 'phone',
          videoUrl: null,
          status: 'cancelled',
          cancelledAt: '2026-11-02T08:00:00.000Z',
          cancelledBy: 'owner',
          cancelReason: 'Imprévu de mon côté.',
          reminderSentAt: '2026-11-03T10:00:00.000Z',
          createdAt: '2026-10-01T08:00:00.000Z',
        },
      ]);
    });

    it.each([
      ['upcoming', '"ends_at" >', '"starts_at" asc'],
      ['past', '"ends_at" <=', '"starts_at" desc'],
    ] as const)(
      'Given scope=%s, Then confirmés seulement, filtre %s maintenant et tri %s',
      async (scope, filter, order) => {
        db.orderBy.mockResolvedValueOnce([]);

        await service.listBookings(scope);

        expect(db.from).toHaveBeenCalledWith(bookings);
        const where = render((db.where.mock.calls as unknown[][])[0][0]);
        expect(where.sql).toContain('"status" =');
        expect(where.sql).toContain(filter);
        expect(where.params).toEqual(['confirmed', NOW.toISOString()]);
        const orderBy = render((db.orderBy.mock.calls as unknown[][])[0][0]);
        expect(orderBy.sql).toContain(order);
      },
    );

    it('Given scope=archived, Then annulés seulement, sans condition de date, tri décroissant', async () => {
      db.orderBy.mockResolvedValueOnce([]);

      await service.listBookings('archived');

      expect(db.from).toHaveBeenCalledWith(bookings);
      const where = render((db.where.mock.calls as unknown[][])[0][0]);
      expect(where.sql).toContain('"status" =');
      expect(where.sql).not.toContain('"ends_at"');
      expect(where.params).toEqual(['cancelled']);
      const orderBy = render((db.orderBy.mock.calls as unknown[][])[0][0]);
      expect(orderBy.sql).toContain('"starts_at" desc');
    });

    it('Given aucun rendez-vous, Then une liste vide', async () => {
      db.orderBy.mockResolvedValueOnce([]);

      await expect(service.listBookings('past')).resolves.toEqual([]);
    });
  });

  describe('countUpcoming', () => {
    it('Given trois rendez-vous confirmés à venir, Then { count: 3 }', async () => {
      db.where.mockResolvedValueOnce([{ count: 3 }]);

      await expect(service.countUpcoming()).resolves.toEqual({ count: 3 });
    });

    it('Given le compteur, Then seuls les rendez-vous confirmés qui finissent après maintenant comptent', async () => {
      db.where.mockResolvedValueOnce([{ count: 0 }]);

      await service.countUpcoming();

      expect(db.from).toHaveBeenCalledWith(bookings);
      const where = render((db.where.mock.calls as unknown[][])[0][0]);
      expect(where.sql).toContain('"status" =');
      expect(where.sql).toContain('"ends_at" >');
      expect(where.params).toEqual(
        expect.arrayContaining(['confirmed', NOW.toISOString()]),
      );
    });
  });

  describe('cancelByOwner', () => {
    it('Given un rendez-vous à venir et un motif, Then il passe annulé par le propriétaire à l’heure courante avec le motif', async () => {
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED_BY_OWNER]);

      await service.cancelByOwner(ID, 'Imprévu de mon côté.');

      expect(db.update).toHaveBeenCalledWith(bookings);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'cancelled',
          cancelledAt: NOW,
          cancelledBy: 'owner',
          cancelReason: 'Imprévu de mon côté.',
        }),
      );
    });

    it('Given une annulation réussie, Then la ligne admin du rendez-vous annulé est rendue', async () => {
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED_BY_OWNER]);

      await expect(
        service.cancelByOwner(ID, 'Imprévu de mon côté.'),
      ).resolves.toEqual(
        expect.objectContaining({
          id: ID,
          status: 'cancelled',
          cancelledAt: '2026-11-02T08:00:00.000Z',
          cancelledBy: 'owner',
          cancelReason: 'Imprévu de mon côté.',
          email: 'camille@example.com',
        }),
      );
    });

    it('Given une annulation réussie, Then la réponse ne contient jamais l’empreinte du jeton', async () => {
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED_BY_OWNER]);

      const result = await service.cancelByOwner(ID, 'Imprévu');

      expect(result).not.toHaveProperty('cancelTokenHash');
      expect(JSON.stringify(result)).not.toContain(UPCOMING.cancelTokenHash);
    });

    it.each([
      ['sans motif', undefined],
      ['avec un motif vide', ''],
    ])(
      'Given une annulation %s, Then le motif est enregistré à null',
      async (_case, reason) => {
        givenFound([UPCOMING]);
        givenUpdated([aBooking({ ...CANCELLED_BY_OWNER, cancelReason: null })]);

        await service.cancelByOwner(ID, reason);

        expect(db.set).toHaveBeenCalledWith(
          expect.objectContaining({ cancelReason: null, cancelledBy: 'owner' }),
        );
      },
    );

    it('Given un id, Then le rendez-vous est lu par son id et la mise à jour ne vise que lui tant qu’il est confirmé', async () => {
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED_BY_OWNER]);

      await service.cancelByOwner(ID, 'Imprévu');

      const lookup = render((db.where.mock.calls as unknown[][])[0][0]);
      expect(lookup.params).toEqual([ID]);
      const guard = render((db.where.mock.calls as unknown[][])[1][0]);
      expect(guard.params).toEqual(expect.arrayContaining([ID, 'confirmed']));
    });

    it('Given une annulation réussie, Then le notifier reçoit la ligne annulée par le propriétaire, après la mise à jour', async () => {
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED_BY_OWNER]);

      await service.cancelByOwner(ID, 'Imprévu de mon côté.');
      await flushFireAndForget();

      expect(notifier.bookingCancelled).toHaveBeenCalledTimes(1);
      expect(notifier.bookingCancelled).toHaveBeenCalledWith(
        CANCELLED_BY_OWNER,
      );
      expect(
        notifier.bookingCancelled.mock.invocationCallOrder[0],
      ).toBeGreaterThan(db.returning.mock.invocationCallOrder[0]);
    });

    it('Given un envoi qui ne se termine jamais, Then la réponse est rendue sans l’attendre', async () => {
      notifier.bookingCancelled.mockReturnValueOnce(new Promise(() => {}));
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED_BY_OWNER]);

      await expect(service.cancelByOwner(ID, 'Imprévu')).resolves.toEqual(
        expect.objectContaining({ id: ID, status: 'cancelled' }),
      );
      expect(notifier.bookingCancelled).toHaveBeenCalledTimes(1);
    });

    it('Given un envoi en échec, Then l’annulation tient et l’échec est journalisé avec l’id', async () => {
      notifier.bookingCancelled.mockRejectedValueOnce(new Error('SMTP down'));
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED_BY_OWNER]);

      await expect(service.cancelByOwner(ID, 'Imprévu')).resolves.toEqual(
        expect.objectContaining({ status: 'cancelled' }),
      );
      await flushFireAndForget();

      expect(logged[2]).toHaveBeenCalledWith(
        expect.stringContaining(ID),
        expect.anything(),
      );
    });

    it.each([
      ['annulé par le visiteur', NOW],
      ['annulé et passé', new Date('2026-11-05T08:00:00Z')],
    ])(
      'Given un rendez-vous déjà %s, Then sa ligne admin inchangée, sans mise à jour ni email, motif non écrasé (idempotent)',
      async (_case, now) => {
        jest.setSystemTime(now);
        givenFound([CANCELLED_BY_VISITOR]);

        const result = await service.cancelByOwner(ID, 'Autre motif');
        await flushFireAndForget();

        expect(result).toEqual(
          expect.objectContaining({
            id: ID,
            status: 'cancelled',
            cancelledBy: 'visitor',
            cancelReason: null,
            cancelledAt: '2026-11-01T09:00:00.000Z',
          }),
        );
        expect(db.update).not.toHaveBeenCalled();
        expect(notifier.bookingCancelled).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['qui commence à l’instant', new Date('2026-11-04T10:00:00Z')],
      ['commencé depuis 10 min', new Date('2026-11-04T10:10:00Z')],
      ['passé', new Date('2026-11-05T08:00:00Z')],
    ])(
      'Given un rendez-vous confirmé %s, Then 409 cancel_too_late sans mise à jour ni email',
      async (_case, now) => {
        jest.setSystemTime(now);
        givenFound([UPCOMING]);

        const err = await rejectionOf(service.cancelByOwner(ID, 'Imprévu'));
        await flushFireAndForget();

        expect(err).toBeInstanceOf(ConflictException);
        expect(businessError(err)).toBe('cancel_too_late');
        expect(db.update).not.toHaveBeenCalled();
        expect(notifier.bookingCancelled).not.toHaveBeenCalled();
      },
    );

    it('Given un rendez-vous qui commence dans 1 ms, Then il est encore annulable', async () => {
      jest.setSystemTime(new Date('2026-11-04T09:59:59.999Z'));
      givenFound([UPCOMING]);
      givenUpdated([CANCELLED_BY_OWNER]);

      await service.cancelByOwner(ID, 'Imprévu');

      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('Given un id inconnu, Then 404 booking_not_found sans mise à jour', async () => {
      givenFound([]);

      const err = await rejectionOf(service.cancelByOwner(ID, 'Imprévu'));

      expect(err).toBeInstanceOf(NotFoundException);
      expect(businessError(err)).toBe('booking_not_found');
      expect(db.update).not.toHaveBeenCalled();
    });

    it('Given une annulation concurrente gagnée par le visiteur, Then la ligne relue est rendue, sans email', async () => {
      db.where
        .mockResolvedValueOnce([UPCOMING])
        .mockReturnValueOnce(db)
        .mockResolvedValueOnce([CANCELLED_BY_VISITOR]);
      givenUpdated([]);

      const result = await service.cancelByOwner(ID, 'Imprévu');
      await flushFireAndForget();

      expect(result).toEqual(
        expect.objectContaining({
          id: ID,
          status: 'cancelled',
          cancelledBy: 'visitor',
        }),
      );
      expect(notifier.bookingCancelled).not.toHaveBeenCalled();
    });
  });
});

import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  type INestApplication,
  NotFoundException,
  RequestMethod,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ADMIN_WRITE_THROTTLE } from '../common/throttle';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { AvailabilityService } from './availability.service';
import { BookingAdminController } from './booking-admin.controller';
import { BookingFeedService } from './booking-feed.service';
import { BookingService } from './booking.service';
import {
  anAdminBooking,
  anAvailabilityClosure,
  anAvailabilityRule,
} from './booking-test-builders';

const BOOKING_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CLOSURE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const routeHandler = (
  method: RequestMethod,
  path: string,
): object | undefined => {
  const prototype = BookingAdminController.prototype as unknown as Record<
    string,
    unknown
  >;
  return Object.getOwnPropertyNames(prototype)
    .map((name) => prototype[name])
    .find(
      (candidate): candidate is object =>
        typeof candidate === 'function' &&
        Reflect.getMetadata(PATH_METADATA, candidate) === path &&
        Reflect.getMetadata(METHOD_METADATA, candidate) === method,
    );
};

describe('BookingAdminController (HTTP)', () => {
  let app: INestApplication<App>;
  const availability = {
    listRules: jest.fn(),
    replaceRules: jest.fn(),
    listClosures: jest.fn(),
    createClosure: jest.fn(),
    deleteClosure: jest.fn(),
    setDayOpen: jest.fn(),
    getCalendar: jest.fn(),
    setClosePublicHolidays: jest.fn(),
  };
  const booking = {
    listBookings: jest.fn(),
    countUpcoming: jest.fn(),
    cancelByOwner: jest.fn(),
  };
  const feed = {
    readSubscription: jest.fn(),
    regenerate: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BookingAdminController],
      providers: [
        { provide: AvailabilityService, useValue: availability },
        { provide: BookingService, useValue: booking },
        { provide: BookingFeedService, useValue: feed },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  describe('accès', () => {
    it('Given le contrôleur admin, Then JwtAuthGuard garde la classe entière', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, BookingAdminController),
      ).toEqual([JwtAuthGuard]);
    });

    it.each([
      [RequestMethod.GET, 'availability/rules'],
      [RequestMethod.PUT, 'availability/rules'],
      [RequestMethod.GET, 'availability/closures'],
      [RequestMethod.POST, 'availability/closures'],
      [RequestMethod.DELETE, 'availability/closures/:id'],
      [RequestMethod.PUT, 'availability/days/:date'],
      [RequestMethod.GET, 'availability/calendar'],
      [RequestMethod.PUT, 'availability/settings'],
      [RequestMethod.GET, 'bookings'],
      [RequestMethod.GET, 'bookings/upcoming-count'],
      [RequestMethod.PATCH, 'bookings/:id/cancel'],
      [RequestMethod.GET, 'feed-subscription'],
      [RequestMethod.POST, 'feed-subscription'],
    ])(
      'Given la route %s %s, Then elle est déclarée sur le contrôleur gardé',
      (method, path) => {
        expect(routeHandler(method, path)).toBeDefined();
      },
    );

    it.each([
      [RequestMethod.PUT, 'availability/days/:date'],
      [RequestMethod.GET, 'availability/calendar'],
      [RequestMethod.PUT, 'availability/settings'],
    ])(
      'Given la route du calendrier %s %s, When le propriétaire clique ou change de mois en rafale, Then elle suit la limite des écritures admin et non la limite globale de 10/min',
      (method, path) => {
        const handler = routeHandler(method, path);

        expect(handler).toBeDefined();
        expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler!)).toBe(
          ADMIN_WRITE_THROTTLE.default.limit,
        );
        expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler!)).toBe(
          ADMIN_WRITE_THROTTLE.default.ttl,
        );
      },
    );

    it.each([
      ['GET', RequestMethod.GET],
      ['POST', RequestMethod.POST],
    ])(
      'Given la route %s feed-subscription, Then elle suit la limite globale, sans limite propre',
      (_verb, method) => {
        const handler = routeHandler(method, 'feed-subscription');

        expect(handler).toBeDefined();
        expect(
          Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler!),
        ).toBeUndefined();
        expect(
          Reflect.getMetadata(`${THROTTLER_TTL}default`, handler!),
        ).toBeUndefined();
      },
    );
  });

  describe('GET availability/rules', () => {
    it('Given des plages en base, Then 200 { data } réduit au jour et aux minutes, dans l’ordre du service', async () => {
      availability.listRules.mockResolvedValueOnce([
        anAvailabilityRule({ weekday: 1, startMinute: 540, endMinute: 720 }),
        anAvailabilityRule({ weekday: 3, startMinute: 840, endMinute: 1080 }),
      ]);

      const res = await request(app.getHttpServer()).get(
        '/booking/availability/rules',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          { weekday: 1, startMinute: 540, endMinute: 720 },
          { weekday: 3, startMinute: 840, endMinute: 1080 },
        ],
      });
      expect(availability.listRules).toHaveBeenCalledTimes(1);
    });
  });

  describe('PUT availability/rules', () => {
    const RULES = [
      { weekday: 1, startMinute: 540, endMinute: 720 },
      { weekday: 7, startMinute: 0, endMinute: 1440 },
    ];

    it('Given des plages valides, Then 200 { data } des plages enregistrées, demande transmise au service', async () => {
      availability.replaceRules.mockResolvedValueOnce(
        RULES.map((rule) => anAvailabilityRule(rule)),
      );

      const res = await request(app.getHttpServer())
        .put('/booking/availability/rules')
        .send({ rules: RULES });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: RULES });
      expect(availability.replaceRules).toHaveBeenCalledTimes(1);
      expect(availability.replaceRules).toHaveBeenCalledWith(RULES);
    });

    it('Given une liste vide, Then elle est transmise : toutes les plages sont retirées', async () => {
      availability.replaceRules.mockResolvedValueOnce([]);

      const res = await request(app.getHttpServer())
        .put('/booking/availability/rules')
        .send({ rules: [] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
      expect(availability.replaceRules).toHaveBeenCalledWith([]);
    });

    it.each([
      ['un jour 0', [{ weekday: 0, startMinute: 540, endMinute: 600 }]],
      ['un jour 8', [{ weekday: 8, startMinute: 540, endMinute: 600 }]],
      ['un jour décimal', [{ weekday: 1.5, startMinute: 540, endMinute: 600 }]],
      ['un début négatif', [{ weekday: 1, startMinute: -30, endMinute: 600 }]],
      [
        'une fin après minuit',
        [{ weekday: 1, startMinute: 540, endMinute: 1470 }],
      ],
      [
        'un début hors pas de 30',
        [{ weekday: 1, startMinute: 545, endMinute: 600 }],
      ],
      [
        'une fin hors pas de 30',
        [{ weekday: 1, startMinute: 540, endMinute: 615 }],
      ],
      ['une fin absente', [{ weekday: 1, startMinute: 540 }]],
      [
        'un champ inconnu dans une plage',
        [{ weekday: 1, startMinute: 540, endMinute: 600, id: 'x' }],
      ],
      ['une plage qui n’est pas un objet', ['lundi']],
    ])('Given %s, Then 400 sans appel au service', async (_case, rules) => {
      const res = await request(app.getHttpServer())
        .put('/booking/availability/rules')
        .send({ rules });

      expect(res.status).toBe(400);
      expect(availability.replaceRules).not.toHaveBeenCalled();
    });

    it.each([
      ['rules absent', {}],
      ['rules qui n’est pas une liste', { rules: { weekday: 1 } }],
      [
        '169 plages',
        {
          rules: Array.from({ length: 169 }, () => ({
            weekday: 1,
            startMinute: 0,
            endMinute: 30,
          })),
        },
      ],
      ['un champ inconnu à la racine', { rules: [], replace: true }],
    ])('Given %s, Then 400 sans appel au service', async (_case, body) => {
      const res = await request(app.getHttpServer())
        .put('/booking/availability/rules')
        .send(body);

      expect(res.status).toBe(400);
      expect(availability.replaceRules).not.toHaveBeenCalled();
    });

    it('Given 168 plages, Then elles franchissent la validation', async () => {
      availability.replaceRules.mockResolvedValueOnce([]);
      const rules = Array.from({ length: 168 }, (_, i) => ({
        weekday: (i % 7) + 1,
        startMinute: Math.floor(i / 7) * 60,
        endMinute: Math.floor(i / 7) * 60 + 30,
      }));

      const res = await request(app.getHttpServer())
        .put('/booking/availability/rules')
        .send({ rules });

      expect(res.status).toBe(200);
      expect(availability.replaceRules).toHaveBeenCalledWith(rules);
    });

    it('Given le service refuse des plages qui se chevauchent, Then 400 avec le code métier rules_overlap', async () => {
      availability.replaceRules.mockRejectedValueOnce(
        new BadRequestException({
          error: 'rules_overlap',
          message: 'Deux plages du même jour se chevauchent.',
        }),
      );

      const res = await request(app.getHttpServer())
        .put('/booking/availability/rules')
        .send({ rules: RULES });

      expect(res.status).toBe(400);
      expect(res.body).toEqual(
        expect.objectContaining({
          statusCode: 400,
          error: 'rules_overlap',
          path: '/booking/availability/rules',
        }),
      );
    });
  });

  describe('GET availability/closures', () => {
    it('Given des fermetures à venir, Then 200 { data } réduit à id, dates et motif', async () => {
      availability.listClosures.mockResolvedValueOnce([
        anAvailabilityClosure({
          id: CLOSURE_ID,
          startsOn: '2026-12-24',
          endsOn: '2026-12-26',
          reason: 'Noël',
        }),
        anAvailabilityClosure({
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          startsOn: '2027-01-04',
          endsOn: '2027-01-04',
          reason: null,
        }),
      ]);

      const res = await request(app.getHttpServer()).get(
        '/booking/availability/closures',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          {
            id: CLOSURE_ID,
            startsOn: '2026-12-24',
            endsOn: '2026-12-26',
            reason: 'Noël',
          },
          {
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            startsOn: '2027-01-04',
            endsOn: '2027-01-04',
            reason: null,
          },
        ],
      });
    });
  });

  describe('POST availability/closures', () => {
    it('Given une fermeture valide, Then 201 avec la fermeture créée, demande transmise au service', async () => {
      availability.createClosure.mockResolvedValueOnce(
        anAvailabilityClosure({
          id: CLOSURE_ID,
          startsOn: '2026-12-24',
          endsOn: '2026-12-26',
          reason: 'Noël',
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/booking/availability/closures')
        .send({ startsOn: '2026-12-24', endsOn: '2026-12-26', reason: 'Noël' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: CLOSURE_ID,
        startsOn: '2026-12-24',
        endsOn: '2026-12-26',
        reason: 'Noël',
      });
      expect(availability.createClosure).toHaveBeenCalledWith({
        startsOn: '2026-12-24',
        endsOn: '2026-12-26',
        reason: 'Noël',
      });
    });

    it('Given une fermeture sans motif, Then elle franchit la validation, motif absent', async () => {
      availability.createClosure.mockResolvedValueOnce(
        anAvailabilityClosure({ id: CLOSURE_ID, reason: null }),
      );

      const res = await request(app.getHttpServer())
        .post('/booking/availability/closures')
        .send({ startsOn: '2026-12-24', endsOn: '2026-12-24' });

      expect(res.status).toBe(201);
      const [input] = availability.createClosure.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(input.startsOn).toBe('2026-12-24');
      expect(input.endsOn).toBe('2026-12-24');
      expect(input.reason).toBeUndefined();
    });

    it('Given un motif de 500 caractères, Then il franchit la validation', async () => {
      availability.createClosure.mockResolvedValueOnce(
        anAvailabilityClosure({ id: CLOSURE_ID }),
      );

      const res = await request(app.getHttpServer())
        .post('/booking/availability/closures')
        .send({
          startsOn: '2026-12-24',
          endsOn: '2026-12-26',
          reason: 'a'.repeat(500),
        });

      expect(res.status).toBe(201);
    });

    it.each([
      ['un début absent', { endsOn: '2026-12-26' }],
      ['une fin absente', { startsOn: '2026-12-24' }],
      ['une date française', { startsOn: '24/12/2026', endsOn: '2026-12-26' }],
      [
        'un instant au lieu d’une date',
        { startsOn: '2026-12-24T00:00:00Z', endsOn: '2026-12-26' },
      ],
      [
        'une date inexistante',
        { startsOn: '2026-02-30', endsOn: '2026-03-02' },
      ],
      ['un mois 13', { startsOn: '2026-12-24', endsOn: '2026-13-01' }],
      [
        'un motif de 501 caractères',
        {
          startsOn: '2026-12-24',
          endsOn: '2026-12-26',
          reason: 'a'.repeat(501),
        },
      ],
      [
        'un champ inconnu',
        { startsOn: '2026-12-24', endsOn: '2026-12-26', id: CLOSURE_ID },
      ],
    ])('Given %s, Then 400 sans appel au service', async (_case, body) => {
      const res = await request(app.getHttpServer())
        .post('/booking/availability/closures')
        .send(body);

      expect(res.status).toBe(400);
      expect(availability.createClosure).not.toHaveBeenCalled();
    });

    it('Given le service refuse une fin avant le début, Then 400', async () => {
      availability.createClosure.mockRejectedValueOnce(
        new BadRequestException('La fin précède le début.'),
      );

      const res = await request(app.getHttpServer())
        .post('/booking/availability/closures')
        .send({ startsOn: '2026-12-26', endsOn: '2026-12-24' });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE availability/closures/:id', () => {
    it('Given une fermeture existante, Then 204 sans corps, id transmis', async () => {
      availability.deleteClosure.mockResolvedValueOnce(undefined);

      const res = await request(app.getHttpServer()).delete(
        `/booking/availability/closures/${CLOSURE_ID}`,
      );

      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(availability.deleteClosure).toHaveBeenCalledWith(CLOSURE_ID);
    });

    it('Given un id qui n’est pas un UUID, Then 400 sans appel au service', async () => {
      const res = await request(app.getHttpServer()).delete(
        '/booking/availability/closures/noel',
      );

      expect(res.status).toBe(400);
      expect(availability.deleteClosure).not.toHaveBeenCalled();
    });

    it('Given une fermeture inconnue, Then 404', async () => {
      availability.deleteClosure.mockRejectedValueOnce(
        new NotFoundException('Fermeture introuvable.'),
      );

      const res = await request(app.getHttpServer()).delete(
        `/booking/availability/closures/${CLOSURE_ID}`,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('PUT availability/days/:date', () => {
    const url = '/booking/availability/days/2026-11-12';
    const CLOSED_DAY = {
      date: '2026-11-12',
      state: 'closed',
      holiday: null,
      slotCount: 4,
      closure: null,
    };

    it('Given open: false, Then 200 avec le jour relu par le service, date et état souhaité transmis', async () => {
      availability.setDayOpen.mockResolvedValueOnce(CLOSED_DAY);

      const res = await request(app.getHttpServer())
        .put(url)
        .send({ open: false });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(CLOSED_DAY);
      expect(availability.setDayOpen).toHaveBeenCalledTimes(1);
      expect(availability.setDayOpen).toHaveBeenCalledWith('2026-11-12', false);
    });

    it('Given open: true sur un férié, Then 200 avec le férié rouvert, open transmis en booléen', async () => {
      const reopened = {
        date: '2026-11-11',
        state: 'open',
        holiday: 'Armistice 1918',
        slotCount: 4,
        closure: null,
      };
      availability.setDayOpen.mockResolvedValueOnce(reopened);

      const res = await request(app.getHttpServer())
        .put('/booking/availability/days/2026-11-11')
        .send({ open: true });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(reopened);
      expect(availability.setDayOpen).toHaveBeenCalledWith('2026-11-11', true);
    });

    it.each([
      ['une date française', '/booking/availability/days/12-11-2026'],
      ['une date inexistante', '/booking/availability/days/2026-02-30'],
      ['un mois 13', '/booking/availability/days/2026-13-01'],
      ['un mot', '/booking/availability/days/demain'],
      ['une date sans zéro', '/booking/availability/days/2026-11-2'],
    ])(
      'Given %s dans le chemin, Then 400 sans appel au service',
      async (_case, path) => {
        const res = await request(app.getHttpServer())
          .put(path)
          .send({ open: false });

        expect(res.status).toBe(400);
        expect(availability.setDayOpen).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['open absent', {}],
      ['open null', { open: null }],
      ['open en chaîne « false »', { open: 'false' }],
      ['open en nombre', { open: 0 }],
      ['un champ inconnu', { open: false, kind: 'closed' }],
    ])('Given %s, Then 400 sans appel au service', async (_case, body) => {
      const res = await request(app.getHttpServer()).put(url).send(body);

      expect(res.status).toBe(400);
      expect(availability.setDayOpen).not.toHaveBeenCalled();
    });

    it.each([
      [
        422,
        'day_in_past',
        new UnprocessableEntityException({
          error: 'day_in_past',
          message: 'Ce jour est passé.',
        }),
      ],
      [
        422,
        'day_out_of_range',
        new UnprocessableEntityException({
          error: 'day_out_of_range',
          message: 'Ce jour est trop loin.',
        }),
      ],
      [
        409,
        'day_in_closure',
        new ConflictException({
          error: 'day_in_closure',
          message: 'Ce jour est couvert par une fermeture.',
        }),
      ],
    ])(
      'Given le service refuse, Then %i avec le code métier %s dans error',
      async (status, code, failure) => {
        availability.setDayOpen.mockRejectedValueOnce(failure);

        const res = await request(app.getHttpServer())
          .put(url)
          .send({ open: false });

        expect(res.status).toBe(status);
        expect(res.body).toEqual(
          expect.objectContaining({
            statusCode: status,
            error: code,
            path: url,
          }),
        );
      },
    );
  });

  describe('GET availability/calendar', () => {
    const url = '/booking/availability/calendar';
    const MONTH = {
      month: '2026-11',
      today: '2026-11-10',
      previousMonth: null,
      nextMonth: '2026-12',
      closePublicHolidays: true,
      days: [
        {
          date: '2026-11-11',
          state: 'holiday',
          holiday: 'Armistice 1918',
          slotCount: 4,
          closure: null,
        },
        {
          date: '2026-11-24',
          state: 'closed-period',
          holiday: null,
          slotCount: 4,
          closure: {
            startsOn: '2026-11-24',
            endsOn: '2026-11-26',
            reason: 'Congés',
          },
        },
      ],
    };

    it('Given aucun mois, Then 200 avec le mois rendu par le service, mois absent transmis', async () => {
      availability.getCalendar.mockResolvedValueOnce(MONTH);

      const res = await request(app.getHttpServer()).get(url);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MONTH);
      expect(availability.getCalendar).toHaveBeenCalledTimes(1);
      const [month] = availability.getCalendar.mock.calls[0] as unknown[];
      expect(month).toBeUndefined();
    });

    it('Given month=2027-02, Then 200 et le mois transmis tel quel', async () => {
      availability.getCalendar.mockResolvedValueOnce({
        ...MONTH,
        month: '2027-02',
        days: [],
      });

      const res = await request(app.getHttpServer())
        .get(url)
        .query({ month: '2027-02' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...MONTH, month: '2027-02', days: [] });
      expect(availability.getCalendar).toHaveBeenCalledWith('2027-02');
    });

    it.each([
      ['un mois 13', 'month=2026-13'],
      ['un mois 00', 'month=2026-00'],
      ['un mois sans zéro', 'month=2026-1'],
      ['une année sur deux chiffres', 'month=26-11'],
      ['une date complète', 'month=2026-11-01'],
      ['un mot', 'month=novembre'],
      ['un mois vide', 'month='],
      ['deux mois', 'month=2026-11&month=2026-12'],
      ['un paramètre inconnu', 'month=2026-11&page=2'],
    ])(
      'Given %s (%s), Then 400 sans appel au service',
      async (_case, query) => {
        const res = await request(app.getHttpServer()).get(`${url}?${query}`);

        expect(res.status).toBe(400);
        expect(availability.getCalendar).not.toHaveBeenCalled();
      },
    );

    it('Given le service refuse un mois hors du calendrier, Then 400 avec le code métier month_out_of_range', async () => {
      availability.getCalendar.mockRejectedValueOnce(
        new BadRequestException({
          error: 'month_out_of_range',
          message: 'Ce mois est hors du calendrier.',
        }),
      );

      const res = await request(app.getHttpServer())
        .get(url)
        .query({ month: '2027-12' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual(
        expect.objectContaining({
          statusCode: 400,
          error: 'month_out_of_range',
          path: '/booking/availability/calendar?month=2027-12',
        }),
      );
    });
  });

  describe('PUT availability/settings', () => {
    const url = '/booking/availability/settings';

    it.each([false, true])(
      'Given closePublicHolidays: %s, Then 200 avec la valeur enregistrée, transmise en booléen',
      async (value) => {
        availability.setClosePublicHolidays.mockResolvedValueOnce(value);

        const res = await request(app.getHttpServer())
          .put(url)
          .send({ closePublicHolidays: value });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ closePublicHolidays: value });
        expect(availability.setClosePublicHolidays).toHaveBeenCalledTimes(1);
        expect(availability.setClosePublicHolidays).toHaveBeenCalledWith(value);
      },
    );

    it.each([
      ['un corps vide', {}],
      ['la valeur null', { closePublicHolidays: null }],
      ['la chaîne « false »', { closePublicHolidays: 'false' }],
      ['la chaîne « true »', { closePublicHolidays: 'true' }],
      ['le nombre 0', { closePublicHolidays: 0 }],
      ['le nombre 1', { closePublicHolidays: 1 }],
      ['un champ inconnu', { closePublicHolidays: false, id: 'main' }],
    ])('Given %s, Then 400 sans appel au service', async (_case, body) => {
      const res = await request(app.getHttpServer()).put(url).send(body);

      expect(res.status).toBe(400);
      expect(availability.setClosePublicHolidays).not.toHaveBeenCalled();
    });
  });

  describe('GET bookings', () => {
    it.each(['upcoming', 'past', 'archived'] as const)(
      'Given scope=%s, Then 200 { data } des rendez-vous du service, coordonnées comprises',
      async (scope) => {
        const rows = [
          anAdminBooking({
            id: BOOKING_ID,
            phone: '+33 6 12 34 56 78',
            format: 'phone',
            videoUrl: null,
            company: 'Société Exemple',
          }),
          anAdminBooking({
            status: 'cancelled',
            cancelledAt: '2026-11-01T09:00:00.000Z',
            cancelledBy: 'owner',
            cancelReason: 'Imprévu',
          }),
        ];
        booking.listBookings.mockResolvedValueOnce(rows);

        const res = await request(app.getHttpServer())
          .get('/booking/bookings')
          .query({ scope });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: rows });
        expect(booking.listBookings).toHaveBeenCalledWith(scope);
      },
    );

    it.each([
      ['scope absent', {}],
      ['scope hors liste', { scope: 'all' }],
      ['un paramètre inconnu', { scope: 'upcoming', page: 2 }],
    ])('Given %s, Then 400 sans appel au service', async (_case, query) => {
      const res = await request(app.getHttpServer())
        .get('/booking/bookings')
        .query(query);

      expect(res.status).toBe(400);
      expect(booking.listBookings).not.toHaveBeenCalled();
    });
  });

  describe('GET bookings/upcoming-count', () => {
    it('Given trois rendez-vous à venir, Then 200 { count: 3 }', async () => {
      booking.countUpcoming.mockResolvedValueOnce({ count: 3 });

      const res = await request(app.getHttpServer()).get(
        '/booking/bookings/upcoming-count',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 3 });
      expect(booking.listBookings).not.toHaveBeenCalled();
    });
  });

  describe('PATCH bookings/:id/cancel', () => {
    const url = `/booking/bookings/${BOOKING_ID}/cancel`;

    it('Given un motif, Then 200 avec le rendez-vous annulé, id et motif transmis', async () => {
      const cancelled = anAdminBooking({
        id: BOOKING_ID,
        status: 'cancelled',
        cancelledAt: '2026-11-02T08:00:00.000Z',
        cancelledBy: 'owner',
        cancelReason: 'Imprévu de mon côté.',
      });
      booking.cancelByOwner.mockResolvedValueOnce(cancelled);

      const res = await request(app.getHttpServer())
        .patch(url)
        .send({ reason: 'Imprévu de mon côté.' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(cancelled);
      expect(booking.cancelByOwner).toHaveBeenCalledWith(
        BOOKING_ID,
        'Imprévu de mon côté.',
      );
    });

    it('Given aucun motif, Then 200, motif absent transmis au service', async () => {
      booking.cancelByOwner.mockResolvedValueOnce(
        anAdminBooking({ id: BOOKING_ID, status: 'cancelled' }),
      );

      const res = await request(app.getHttpServer()).patch(url).send({});

      expect(res.status).toBe(200);
      const [id, reason] = booking.cancelByOwner.mock.calls[0] as unknown[];
      expect(id).toBe(BOOKING_ID);
      expect(reason).toBeUndefined();
    });

    it('Given un motif de 500 caractères, Then il franchit la validation', async () => {
      booking.cancelByOwner.mockResolvedValueOnce(
        anAdminBooking({ id: BOOKING_ID, status: 'cancelled' }),
      );

      const res = await request(app.getHttpServer())
        .patch(url)
        .send({ reason: 'a'.repeat(500) });

      expect(res.status).toBe(200);
      expect(booking.cancelByOwner).toHaveBeenCalledWith(
        BOOKING_ID,
        'a'.repeat(500),
      );
    });

    it.each([
      ['un motif de 501 caractères', url, { reason: 'a'.repeat(501) }],
      ['un champ inconnu', url, { reason: 'x', status: 'cancelled' }],
      ['un id qui n’est pas un UUID', '/booking/bookings/abc/cancel', {}],
    ])(
      'Given %s, Then 400 sans appel au service',
      async (_case, path, body) => {
        const res = await request(app.getHttpServer()).patch(path).send(body);

        expect(res.status).toBe(400);
        expect(booking.cancelByOwner).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        404,
        'booking_not_found',
        new NotFoundException({
          error: 'booking_not_found',
          message: 'Rendez-vous introuvable.',
        }),
      ],
      [
        409,
        'cancel_too_late',
        new ConflictException({
          error: 'cancel_too_late',
          message: 'Le rendez-vous a déjà commencé.',
        }),
      ],
    ])(
      'Given le service refuse, Then %i avec le code métier %s dans error',
      async (status, code, failure) => {
        booking.cancelByOwner.mockRejectedValueOnce(failure);

        const res = await request(app.getHttpServer())
          .patch(url)
          .send({ reason: 'Imprévu' });

        expect(res.status).toBe(status);
        expect(res.body).toEqual(
          expect.objectContaining({
            statusCode: status,
            error: code,
            path: url,
          }),
        );
      },
    );
  });

  describe('GET feed-subscription', () => {
    const url = '/booking/feed-subscription';

    it.each([
      ['non configuré', { status: 'unconfigured' }],
      ['sans lien', { status: 'none' }],
      [
        'actif',
        {
          status: 'active',
          token: 'XYJXH9MoGdppkZYT0jI3g2rP-qFcqKBWL0budyMj488',
          createdAt: '2026-10-15T08:32:00.000Z',
        },
      ],
    ])(
      'Given un abonnement %s, Then 200 avec l’état du service, non mis en cache',
      async (_case, subscription) => {
        feed.readSubscription.mockResolvedValueOnce(subscription);

        const res = await request(app.getHttpServer()).get(url);

        expect(res.status).toBe(200);
        expect(res.body).toEqual(subscription);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(feed.readSubscription).toHaveBeenCalledTimes(1);
        expect(feed.regenerate).not.toHaveBeenCalled();
      },
    );
  });

  describe('POST feed-subscription', () => {
    const url = '/booking/feed-subscription';

    it('Given un secret configuré, Then 201 avec le nouveau lien actif, non mis en cache', async () => {
      const subscription = {
        status: 'active',
        token: 'XYJXH9MoGdppkZYT0jI3g2rP-qFcqKBWL0budyMj488',
        createdAt: '2026-10-15T08:32:00.000Z',
      };
      feed.regenerate.mockResolvedValueOnce(subscription);

      const res = await request(app.getHttpServer()).post(url);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(subscription);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(feed.regenerate).toHaveBeenCalledTimes(1);
      expect(feed.regenerate).toHaveBeenCalledWith();
      expect(feed.readSubscription).not.toHaveBeenCalled();
    });

    it('Given aucun secret configuré, Then 409 feed_not_configured', async () => {
      feed.regenerate.mockRejectedValueOnce(
        new ConflictException({
          error: 'feed_not_configured',
          message: 'Abonnement non configuré.',
        }),
      );

      const res = await request(app.getHttpServer()).post(url);

      expect(res.status).toBe(409);
      expect(res.body).toEqual(
        expect.objectContaining({
          statusCode: 409,
          error: 'feed_not_configured',
          message: 'Abonnement non configuré.',
          path: url,
        }),
      );
      expect(feed.regenerate).toHaveBeenCalledTimes(1);
    });
  });
});

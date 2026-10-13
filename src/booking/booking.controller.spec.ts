import 'reflect-metadata';
import {
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
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import request from 'supertest';
import type { App } from 'supertest/types';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PUBLIC_READ_THROTTLE } from '../common/throttle';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

const routeHandler = (
  method: RequestMethod,
  path: string,
): object | undefined => {
  const prototype = BookingController.prototype as unknown as Record<
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

describe('BookingController (HTTP)', () => {
  let app: INestApplication<App>;
  const booking = {
    getSlots: jest.fn(),
    create: jest.fn(),
    previewCancellation: jest.fn(),
    cancelByVisitor: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BookingController],
      providers: [{ provide: BookingService, useValue: booking }],
    }).compile();
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

  describe('GET slots', () => {
    it('Given des créneaux calculés, When un visiteur les demande, Then 200 avec le fuseau et les créneaux, jamais mis en cache', async () => {
      const payload = {
        timeZone: 'Europe/Paris',
        slots: [
          {
            startsAt: '2026-11-04T08:00:00.000Z',
            endsAt: '2026-11-04T08:30:00.000Z',
          },
        ],
      };
      booking.getSlots.mockResolvedValueOnce(payload);

      const res = await request(app.getHttpServer()).get('/booking/slots');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(payload);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(booking.getSlots).toHaveBeenCalledTimes(1);
    });

    it('Given la route publique des créneaux, Then elle n’a aucune garde et suit la limite des lectures publiques', () => {
      const handler = routeHandler(RequestMethod.GET, 'slots');

      expect(handler).toBeDefined();
      expect(
        Reflect.getMetadata(GUARDS_METADATA, BookingController),
      ).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, handler!)).toBeUndefined();
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler!)).toBe(
        PUBLIC_READ_THROTTLE.default.limit,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler!)).toBe(
        PUBLIC_READ_THROTTLE.default.ttl,
      );
    });
  });

  describe('POST bookings', () => {
    const REQUEST = {
      startsAt: '2026-11-04T10:00:00.000Z',
      name: 'Camille Martin',
      email: 'camille@example.com',
      format: 'video',
      message: 'Refonte de notre application Angular.',
      website: '',
    };
    const CONFIRMATION = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      startsAt: '2026-11-04T10:00:00.000Z',
      endsAt: '2026-11-04T10:30:00.000Z',
      format: 'video',
      videoUrl: 'https://meet.jit.si/nedellec-0123456789abcdef',
    };

    it('Given une demande valide, When le visiteur réserve, Then 201 avec la confirmation du service, demande transmise telle quelle', async () => {
      booking.create.mockResolvedValueOnce(CONFIRMATION);

      const res = await request(app.getHttpServer())
        .post('/booking/bookings')
        .send(REQUEST);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(CONFIRMATION);
      expect(booking.create).toHaveBeenCalledTimes(1);
      expect({
        ...((booking.create.mock.calls as unknown[][])[0][0] as object),
      }).toEqual(REQUEST);
    });

    it('Given le champ piège rempli, When la demande arrive, Then il franchit la liste blanche jusqu’au service', async () => {
      booking.create.mockResolvedValueOnce(CONFIRMATION);

      const res = await request(app.getHttpServer())
        .post('/booking/bookings')
        .send({ ...REQUEST, website: 'https://spam.test' });

      expect(res.status).toBe(201);
      expect(booking.create).toHaveBeenCalledWith(
        expect.objectContaining({ website: 'https://spam.test' }),
      );
    });

    it.each([
      ['un champ inconnu', { ...REQUEST, status: 'cancelled' }],
      ['le format téléphone sans numéro', { ...REQUEST, format: 'phone' }],
      ['un instant non ISO', { ...REQUEST, startsAt: '04/11/2026 10:00' }],
    ])(
      'Given %s, When la demande arrive, Then 400 sans appel au service',
      async (_case, body) => {
        const res = await request(app.getHttpServer())
          .post('/booking/bookings')
          .send(body);

        expect(res.status).toBe(400);
        expect(booking.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        409,
        'slot_taken',
        new ConflictException({
          error: 'slot_taken',
          message: 'Créneau déjà pris.',
        }),
      ],
      [
        422,
        'slot_unavailable',
        new UnprocessableEntityException({
          error: 'slot_unavailable',
          message: 'Créneau indisponible.',
        }),
      ],
      [
        422,
        'booking_limit_reached',
        new UnprocessableEntityException({
          error: 'booking_limit_reached',
          message: 'Plafond atteint.',
        }),
      ],
    ])(
      'Given le service refuse, When la demande arrive, Then %i avec le code métier %s dans error',
      async (status, code, failure) => {
        booking.create.mockRejectedValueOnce(failure);

        const res = await request(app.getHttpServer())
          .post('/booking/bookings')
          .send(REQUEST);

        expect(res.status).toBe(status);
        expect(res.body).toEqual(
          expect.objectContaining({
            statusCode: status,
            error: code,
            path: '/booking/bookings',
          }),
        );
      },
    );

    it('Given la route de réservation, Then elle est publique et limitée à 5 créations par IP sur 10 min', () => {
      const handler = routeHandler(RequestMethod.POST, 'bookings');

      expect(handler).toBeDefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, handler!)).toBeUndefined();
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler!)).toBe(
        5,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler!)).toBe(
        600_000,
      );
    });
  });

  describe.each([
    ['bookings/cancel/preview', 'previewCancellation'],
    ['bookings/cancel', 'cancelByVisitor'],
  ] as const)('POST %s', (path, method) => {
    const TOKEN = 'Qm9va2luZ0NhbmNlbFRva2VuX0Zvcl9UZXN0c18wMTI';
    const url = `/booking/${path}`;

    it.each([
      ['42 caractères', { token: TOKEN.slice(1) }],
      ['44 caractères', { token: `${TOKEN}A` }],
      ['un caractère hors base64url', { token: `${TOKEN.slice(1)}+` }],
      ['un jeton absent', {}],
      ['un champ inconnu', { token: TOKEN, id: 'x' }],
    ])(
      'Given %s, When la demande arrive, Then 400 sans appel au service',
      async (_case, body) => {
        const res = await request(app.getHttpServer()).post(url).send(body);

        expect(res.status).toBe(400);
        expect(booking[method]).not.toHaveBeenCalled();
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
          message: 'Le rendez-vous a commencé.',
        }),
      ],
    ])(
      'Given le service refuse, Then %i avec le code métier %s dans error, sans jeton dans le chemin',
      async (status, code, failure) => {
        booking[method].mockRejectedValueOnce(failure);

        const res = await request(app.getHttpServer())
          .post(url)
          .send({ token: TOKEN });

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

    it('Given la route, Then elle est publique, sans limite propre (limite globale)', () => {
      const handler = routeHandler(RequestMethod.POST, path);

      expect(handler).toBeDefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, handler!)).toBeUndefined();
      expect(
        Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler!),
      ).toBeUndefined();
    });
  });

  describe('POST bookings/cancel/preview', () => {
    it('Given un jeton valide, Then 200 avec l’aperçu du service, jeton transmis depuis le corps', async () => {
      const preview = {
        startsAt: '2026-11-04T10:00:00.000Z',
        endsAt: '2026-11-04T10:30:00.000Z',
        format: 'video',
        status: 'confirmed',
        cancellable: true,
      };
      booking.previewCancellation.mockResolvedValueOnce(preview);

      const res = await request(app.getHttpServer())
        .post('/booking/bookings/cancel/preview')
        .send({ token: 'Qm9va2luZ0NhbmNlbFRva2VuX0Zvcl9UZXN0c18wMTI' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(preview);
      expect(booking.previewCancellation).toHaveBeenCalledWith(
        'Qm9va2luZ0NhbmNlbFRva2VuX0Zvcl9UZXN0c18wMTI',
      );
    });
  });

  describe('POST bookings/cancel', () => {
    it('Given un jeton valide, Then 200 { status: cancelled }, jeton transmis depuis le corps', async () => {
      booking.cancelByVisitor.mockResolvedValueOnce({ status: 'cancelled' });

      const res = await request(app.getHttpServer())
        .post('/booking/bookings/cancel')
        .send({ token: 'Qm9va2luZ0NhbmNlbFRva2VuX0Zvcl9UZXN0c18wMTI' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'cancelled' });
      expect(booking.cancelByVisitor).toHaveBeenCalledWith(
        'Qm9va2luZ0NhbmNlbFRva2VuX0Zvcl9UZXN0c18wMTI',
      );
    });
  });
});

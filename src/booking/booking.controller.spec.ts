import 'reflect-metadata';
import {
  type INestApplication,
  RequestMethod,
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
  const booking = { getSlots: jest.fn() };

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
});

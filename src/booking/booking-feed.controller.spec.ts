import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { BookingFeedController } from './booking-feed.controller';
import { BookingFeedService } from './booking-feed.service';
import { aBooking } from './booking-test-builders';
import { deriveFeedToken } from './feed-token';

const SECRET = 'a'.repeat(32);
const SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const TOKEN = deriveFeedToken(SECRET, SALT);
const BOOKING = aBooking({ id: '11111111-1111-4111-8111-111111111111' });

type ErrorBody = Record<string, unknown>;
const withoutTimestamp = (body: ErrorBody): ErrorBody =>
  Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== 'timestamp'),
  );

describe('BookingFeedController (HTTP)', () => {
  let app: INestApplication<App>;
  let db: ReturnType<typeof createMockDb>;
  const config: {
    bookingFeedSecret: string | undefined;
    publicSiteUrl: string;
  } = {
    bookingFeedSecret: SECRET,
    publicSiteUrl: 'https://nedellec-julien.fr',
  };

  beforeAll(async () => {
    db = createMockDb();
    const module = await Test.createTestingModule({
      controllers: [BookingFeedController],
      providers: [
        BookingFeedService,
        { provide: DRIZZLE, useValue: db },
        { provide: AppConfigService, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    db.limit.mockReset().mockReturnValue(db);
    db.orderBy.mockReset().mockReturnValue(db);
    config.bookingFeedSecret = SECRET;
  });

  describe('GET feed/:file avec le bon jeton', () => {
    beforeEach(() => {
      db.limit.mockResolvedValueOnce([{ feedSalt: SALT }]);
      db.orderBy.mockResolvedValueOnce([BOOKING]);
    });

    it('Given un abonnement actif, Then 200 et un corps iCalendar qui porte le rendez-vous', async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/booking/feed/${TOKEN}.ics`,
      );

      expect(res.status).toBe(200);
      expect(res.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(res.text).toContain(`\r\nUID:${BOOKING.id}\r\n`);
    });

    it('Given un abonnement actif, Then les en-têtes text/calendar, no-store et noindex', async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/booking/feed/${TOKEN}.ics`,
      );

      expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    });
  });

  describe('GET feed/:file refusé', () => {
    const NOT_FOUND = {
      statusCode: 404,
      error: 'Not Found',
      message: 'Not Found',
      path: '/api/booking/feed/[Filtered]',
    };

    const cases: [string, string, () => void][] = [
      [
        'aucun secret configuré',
        `/api/booking/feed/${TOKEN}.ics`,
        () => {
          config.bookingFeedSecret = undefined;
        },
      ],
      ['un fichier malformé', `/api/booking/feed/${TOKEN}.txt`, () => {}],
      [
        'un / encodé dans le jeton',
        `/api/booking/feed/${TOKEN.slice(0, 20)}%2F${TOKEN.slice(21)}.ics`,
        () => {},
      ],
      [
        'aucun abonnement créé',
        `/api/booking/feed/${TOKEN}.ics`,
        () => {
          db.limit.mockResolvedValueOnce([{ feedSalt: null }]);
        },
      ],
      [
        'un jeton bien formé mais faux',
        `/api/booking/feed/${deriveFeedToken(SECRET, 'BBBBBBBBBBBBBBBBBBBBBB')}.ics`,
        () => {
          db.limit.mockResolvedValueOnce([{ feedSalt: SALT }]);
        },
      ],
    ];

    it.each(cases)(
      'Given %s, Then 404 au corps Not Found indistinct, chemin masqué, sans aucun rendez-vous lu',
      async (_case, path, arrange) => {
        arrange();

        const res = await request(app.getHttpServer()).get(path);

        expect(res.status).toBe(404);
        expect(withoutTimestamp(res.body as ErrorBody)).toEqual(NOT_FOUND);
        expect(res.text).not.toContain('BEGIN:VCALENDAR');
        expect(db.orderBy).not.toHaveBeenCalled();
      },
    );
  });

  it('Given la route du flux, Then elle n’a aucune garde : un client d’abonnement n’a ni cookie ni en-tête', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, BookingFeedController),
    ).toBeUndefined();
  });
});

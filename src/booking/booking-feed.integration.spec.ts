import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { type Booking, bookings, schema } from '../database/schema';
import { AvailabilityService } from './availability.service';
import { BookingAdminController } from './booking-admin.controller';
import { BookingFeedController } from './booking-feed.controller';
import { BookingFeedService } from './booking-feed.service';
import { BookingService } from './booking.service';
import { aBooking } from './booking-test-builders';

const ADMIN_URL = process.env.BOOKING_IT_DATABASE_URL;
// Base dédiée : les autres suites d'intégration vident booking et réécrivent booking_setting en parallèle.
const DATABASE_NAME = 'booking_feed_it';

const SECRET = 'feed-secret-for-integration-tests-0123456789';
const OTHER_SECRET = 'another-feed-secret-for-integration-tests-01';
const DAY = 24 * 3_600_000;

(ADMIN_URL ? describe : describe.skip)('Flux d’agenda sur Postgres', () => {
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let db: Database;
  const apps: INestApplication<App>[] = [];

  const createApp = async (
    secret: string,
  ): Promise<{ app: INestApplication<App>; feed: BookingFeedService }> => {
    const module = await Test.createTestingModule({
      controllers: [BookingFeedController],
      providers: [
        BookingFeedService,
        { provide: DRIZZLE, useValue: db },
        {
          provide: AppConfigService,
          useValue: {
            bookingFeedSecret: secret,
            publicSiteUrl: 'https://nedellec-julien.fr',
          },
        },
      ],
    }).compile();
    const app = module.createNestApplication<INestApplication<App>>();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    apps.push(app);
    return { app, feed: module.get(BookingFeedService) };
  };

  const createAdminApp = async (
    secret: string | undefined,
  ): Promise<INestApplication<App>> => {
    const module = await Test.createTestingModule({
      controllers: [BookingAdminController, BookingFeedController],
      providers: [
        BookingFeedService,
        { provide: AvailabilityService, useValue: {} },
        { provide: BookingService, useValue: {} },
        { provide: DRIZZLE, useValue: db },
        {
          provide: AppConfigService,
          useValue: {
            bookingFeedSecret: secret,
            publicSiteUrl: 'https://nedellec-julien.fr',
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication<INestApplication<App>>();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    apps.push(app);
    return app;
  };

  const insertBooking = async (
    endsIn: number,
    overrides: Partial<Booking> = {},
  ): Promise<string> => {
    const id = randomUUID();
    const endsAt = new Date(Date.now() + endsIn);
    await db.insert(bookings).values(
      aBooking({
        id,
        startsAt: new Date(endsAt.getTime() - 30 * 60_000),
        endsAt,
        email: `${id}@example.com`,
        cancelTokenHash: id.replace(/-/g, '').padEnd(64, '0'),
        createdAt: new Date(endsAt.getTime() - 3 * DAY),
        ...overrides,
      }),
    );
    return id;
  };

  const getFeed = (app: INestApplication<App>, token: string) =>
    request(app.getHttpServer()).get(`/booking/feed/${token}.ics`);

  beforeAll(async () => {
    admin = postgres(ADMIN_URL ?? '', { max: 1, onnotice: () => {} });
    await admin.unsafe(`drop database if exists ${DATABASE_NAME} with (force)`);
    await admin.unsafe(`create database ${DATABASE_NAME}`);
    const url = new URL(ADMIN_URL ?? '');
    url.pathname = `/${DATABASE_NAME}`;
    client = postgres(url.toString(), { max: 10, onnotice: () => {} });
    db = drizzle(client, { schema, casing: 'snake_case' });
    await migrate(db, {
      migrationsFolder: resolve(__dirname, '../../drizzle'),
    });
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await client.end();
    await admin.unsafe(`drop database if exists ${DATABASE_NAME} with (force)`);
    await admin.end();
  });

  beforeEach(async () => {
    await db.delete(bookings);
    await db.execute(sql`delete from booking_setting`);
  });

  it('Given les migrations jouées, Then 0026 est au journal et le sel et sa date sont liés par booking_setting_feed_check', async () => {
    const journal = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../drizzle/meta/_journal.json'),
        'utf8',
      ),
    ) as { entries: { tag: string }[] };

    expect(journal.entries.map((entry) => entry.tag)).toContain(
      '0026_booking_feed',
    );
    const failure = await db
      .execute(
        sql`insert into booking_setting (id, feed_salt) values ('main', 'AAAAAAAAAAAAAAAAAAAAAA')`,
      )
      .then(
        () => null,
        (err: unknown) => err,
      );

    const pgError = (failure as { cause?: unknown } | null)?.cause ?? failure;
    expect(pgError).toEqual(
      expect.objectContaining({
        code: '23514',
        constraint_name: 'booking_setting_feed_check',
      }),
    );
  });

  it('Given un lien créé, When le flux est lu, Then 200 avec les confirmés à venir et récents, sans les annulés ni ceux finis il y a 7 mois', async () => {
    const { app, feed } = await createApp(SECRET);
    const upcoming = await insertBooking(3 * DAY);
    const endedFiveMonthsAgo = await insertBooking(-150 * DAY);
    const endedSevenMonthsAgo = await insertBooking(-210 * DAY);
    const cancelled = await insertBooking(4 * DAY, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: 'visitor',
    });
    const { token } = await feed.regenerate();

    const res = await getFeed(app, token);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    const uids = res.text
      .split('\r\n')
      .filter((line) => line.startsWith('UID:'));
    expect(uids).toEqual([`UID:${endedFiveMonthsAgo}`, `UID:${upcoming}`]);
    expect(res.text).not.toContain(endedSevenMonthsAgo);
    expect(res.text).not.toContain(cancelled);
  });

  it('Given un lien régénéré, Then l’ancien jeton reçoit 404 et le nouveau 200', async () => {
    const { app, feed } = await createApp(SECRET);
    await insertBooking(3 * DAY);
    const { token: previous } = await feed.regenerate();
    const { token: current } = await feed.regenerate();

    expect(current).not.toBe(previous);
    expect((await getFeed(app, previous)).status).toBe(404);
    expect((await getFeed(app, current)).status).toBe(200);
  });

  it('Given un autre secret avec le même sel en base, Then l’ancien jeton reçoit 404', async () => {
    const { app, feed } = await createApp(SECRET);
    await insertBooking(3 * DAY);
    const { token } = await feed.regenerate();
    const { app: rotated } = await createApp(OTHER_SECRET);

    expect((await getFeed(app, token)).status).toBe(200);
    expect((await getFeed(rotated, token)).status).toBe(404);
  });

  it('Given aucun lien jamais créé, Then un jeton bien formé reçoit 404', async () => {
    const { app } = await createApp(SECRET);
    await insertBooking(3 * DAY);

    expect((await getFeed(app, 'A'.repeat(43))).status).toBe(404);
  });

  describe('administration du lien', () => {
    const SUBSCRIPTION_URL = '/booking/feed-subscription';
    const readLink = (app: INestApplication<App>) =>
      request(app.getHttpServer()).get(SUBSCRIPTION_URL);
    const createLink = (app: INestApplication<App>) =>
      request(app.getHttpServer()).post(SUBSCRIPTION_URL);

    it('Given aucun lien, When l’admin le crée puis le relit, Then le même jeton et la même date, et le flux répond', async () => {
      const app = await createAdminApp(SECRET);
      await insertBooking(3 * DAY);

      const before = await readLink(app);
      const created = await createLink(app);
      const reread = await readLink(app);

      expect(before.status).toBe(200);
      expect(before.body).toEqual({ status: 'none' });
      expect(created.status).toBe(201);
      expect(Object.keys(created.body as object).sort()).toEqual([
        'createdAt',
        'status',
        'token',
      ]);
      const link = created.body as { status: string; token: string };
      expect(link.status).toBe('active');
      expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(reread.status).toBe(200);
      expect(reread.body).toEqual(created.body);
      expect((await getFeed(app, link.token)).status).toBe(200);
    });

    it('Given un lien créé, Then la date rendue est celle enregistrée et ni le sel ni le secret ne sortent', async () => {
      const app = await createAdminApp(SECRET);

      const created = await createLink(app);

      expect(created.status).toBe(201);
      const [stored] = await db.execute<{
        feed_salt: string;
        feed_created_at: string;
      }>(
        sql`select feed_salt, feed_created_at::text as feed_created_at from booking_setting where id = 'main'`,
      );
      const body = created.body as { createdAt: string };
      expect(new Date(body.createdAt).getTime()).toBe(
        new Date(stored.feed_created_at).getTime(),
      );
      for (const res of [created, await readLink(app)]) {
        expect(res.text).not.toContain(stored.feed_salt);
        expect(res.text).not.toContain(SECRET);
      }
    });

    it('Given un lien régénéré par l’admin, Then l’ancien jeton reçoit 404 et le nouveau 200', async () => {
      const app = await createAdminApp(SECRET);
      await insertBooking(3 * DAY);
      const previous = (await createLink(app)).body as { token: string };

      const current = await createLink(app);

      expect(current.status).toBe(201);
      const next = current.body as { token: string };
      expect(next.token).not.toBe(previous.token);
      expect((await readLink(app)).body).toEqual(current.body);
      expect((await getFeed(app, previous.token)).status).toBe(404);
      expect((await getFeed(app, next.token)).status).toBe(200);
    });

    it.each([false, true])(
      'Given les fériés réglés à %s, When le lien est créé, Then le réglage des fériés est inchangé',
      async (closePublicHolidays) => {
        await db.execute(
          sql`insert into booking_setting (id, close_public_holidays) values ('main', ${closePublicHolidays})`,
        );
        const app = await createAdminApp(SECRET);

        expect((await createLink(app)).status).toBe(201);

        const [setting] = await db.execute<{
          close_public_holidays: boolean;
        }>(
          sql`select close_public_holidays from booking_setting where id = 'main'`,
        );
        expect(setting.close_public_holidays).toBe(closePublicHolidays);
      },
    );

    it('Given aucun secret, Then la lecture rend unconfigured et la création 409 feed_not_configured sans rien écrire', async () => {
      const app = await createAdminApp(undefined);

      const read = await readLink(app);
      const created = await createLink(app);

      expect(read.status).toBe(200);
      expect(read.body).toEqual({ status: 'unconfigured' });
      expect(created.status).toBe(409);
      expect(created.body).toEqual(
        expect.objectContaining({
          statusCode: 409,
          error: 'feed_not_configured',
          message: 'Abonnement non configuré.',
        }),
      );
      const rows = await db.execute(sql`select id from booking_setting`);
      expect(rows).toHaveLength(0);
    });
  });
});

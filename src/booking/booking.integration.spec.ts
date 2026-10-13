import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ConflictException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { isExclusionViolation } from '../common/utils';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  availabilityClosures,
  availabilityRules,
  bookings,
  schema,
} from '../database/schema';
import { AvailabilityService } from './availability.service';
import { BookingService } from './booking.service';
import { aBookingRequest } from './booking-request-test-builder';
import { aBooking, anAvailabilityRule } from './booking-test-builders';

// Base jetable uniquement : les migrations y sont appliquées et les tables booking vidées.
const DATABASE_URL = process.env.BOOKING_IT_DATABASE_URL;

/** Instant UTC à `hour:minute` dans `days` jours : toujours dans la fenêtre réservable. */
const inDays = (days: number, hour: number, minute = 0): Date => {
  const today = new Date();
  return new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + days,
      hour,
      minute,
    ),
  );
};

const errorCode = (reason: unknown): unknown =>
  reason instanceof ConflictException ||
  reason instanceof UnprocessableEntityException
    ? (reason.getResponse() as { error?: unknown }).error
    : reason;

(DATABASE_URL ? describe : describe.skip)(
  'BookingService.create on Postgres',
  () => {
    let client: ReturnType<typeof postgres>;
    let db: Database;
    let service: BookingService;
    const notifier = {
      bookingConfirmed: jest.fn().mockResolvedValue(undefined),
      bookingCancelled: jest.fn().mockResolvedValue(undefined),
    };

    const rowCount = async () => (await db.select().from(bookings)).length;
    const insertBooking = (
      startsAt: Date,
      minutes: number,
      status: 'confirmed' | 'cancelled',
    ) =>
      db.insert(bookings).values(
        aBooking({
          id: randomUUID(),
          startsAt,
          endsAt: new Date(startsAt.getTime() + minutes * 60_000),
          cancelTokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          status,
          cancelledAt: status === 'cancelled' ? new Date() : null,
          cancelledBy: status === 'cancelled' ? 'owner' : null,
        }),
      );

    beforeAll(async () => {
      client = postgres(DATABASE_URL ?? '', { max: 20, onnotice: () => {} });
      db = drizzle(client, { schema, casing: 'snake_case' });
      await migrate(db, {
        migrationsFolder: resolve(__dirname, '../../drizzle'),
      });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const module = await Test.createTestingModule({
        providers: [
          BookingService,
          AvailabilityService,
          { provide: DRIZZLE, useValue: db },
          {
            provide: AppConfigService,
            useValue: { bookingVideoUrlBase: 'https://meet.jit.si' },
          },
        ],
      })
        .useMocker((token) => {
          if (typeof token === 'function' && token.name === 'BookingNotifier') {
            return notifier;
          }
          throw new Error(
            `Unexpected dependency: ${typeof token === 'function' ? token.name : String(token)}`,
          );
        })
        .compile();
      service = module.get(BookingService);
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      await client.end();
    });

    beforeEach(async () => {
      notifier.bookingConfirmed.mockClear();
      notifier.bookingCancelled.mockClear();
      await db.delete(bookings);
      await db.delete(availabilityClosures);
      await db.delete(availabilityRules);
      await db.insert(availabilityRules).values(
        [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
          anAvailabilityRule({
            id: randomUUID(),
            weekday,
            startMinute: 0,
            endMinute: 1440,
          }),
        ),
      );
    });

    it('Given les migrations jouées, Then la contrainte booking_no_overlap de 0023 existe', async () => {
      const journal = JSON.parse(
        readFileSync(
          resolve(__dirname, '../../drizzle/meta/_journal.json'),
          'utf8',
        ),
      ) as { entries: { tag: string }[] };
      const constraints = await db.execute<{
        conname: string;
        contype: string;
      }>(
        sql`select conname, contype from pg_constraint where conname = 'booking_no_overlap'`,
      );

      expect(journal.entries.map((entry) => entry.tag)).toContain(
        '0023_booking_no_overlap',
      );
      expect([...constraints]).toEqual([
        { conname: 'booking_no_overlap', contype: 'x' },
      ]);
    });

    it('Given 10 créations simultanées du même créneau, Then une seule réussit, les 9 autres sont slot_taken', async () => {
      const startsAt = inDays(3, 12).toISOString();

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          service.create(
            aBookingRequest({ startsAt, email: `visiteur${i}@example.com` }),
          ),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const reasons = results.flatMap((r) =>
        r.status === 'rejected' ? [r.reason as unknown] : [],
      );
      expect(reasons).toHaveLength(9);
      expect(
        reasons.every((reason) => reason instanceof ConflictException),
      ).toBe(true);
      expect(reasons.map(errorCode)).toEqual(Array(9).fill('slot_taken'));
      expect(await rowCount()).toBe(1);
    }, 15_000);

    it('Given deux créations simultanées à 12:00 et 12:30 UTC, Then une seule réussit (battement sous verrou)', async () => {
      const results = await Promise.allSettled([
        service.create(
          aBookingRequest({
            startsAt: inDays(3, 12).toISOString(),
            email: 'a@example.com',
          }),
        ),
        service.create(
          aBookingRequest({
            startsAt: inDays(3, 12, 30).toISOString(),
            email: 'b@example.com',
          }),
        ),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        results.flatMap((r) =>
          r.status === 'rejected' ? [errorCode(r.reason)] : [],
        ),
      ).toEqual(['slot_taken']);
      expect(await rowCount()).toBe(1);
    }, 15_000);

    it('Given trois créations simultanées du même email en casse différente, Then deux au plus réussissent, la troisième est booking_limit_reached', async () => {
      const results = await Promise.allSettled(
        [
          { email: 'Cap@Example.com', hour: 10 },
          { email: 'cap@example.com', hour: 14 },
          { email: 'CAP@EXAMPLE.COM', hour: 18 },
        ].map(({ email, hour }) =>
          service.create(
            aBookingRequest({ email, startsAt: inDays(4, hour).toISOString() }),
          ),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      expect(
        results.flatMap((r) =>
          r.status === 'rejected' ? [errorCode(r.reason)] : [],
        ),
      ).toEqual(['booking_limit_reached']);
      expect(await rowCount()).toBe(2);
    }, 15_000);

    it('Given un rendez-vous confirmé, When un chevauchement confirmé est inséré en SQL direct, Then 23P01 sur booking_no_overlap', async () => {
      await insertBooking(inDays(5, 10), 30, 'confirmed');

      const failure = await insertBooking(
        inDays(5, 10, 15),
        30,
        'confirmed',
      ).then(
        () => null,
        (err: unknown) => err,
      );

      expect(isExclusionViolation(failure, 'booking_no_overlap')).toBe(true);
      expect(await rowCount()).toBe(1);
    });

    it('Given un rendez-vous confirmé qui finit à 10:30, When un autre commence à 10:30, Then la plage semi-ouverte l’accepte', async () => {
      await insertBooking(inDays(5, 10), 30, 'confirmed');
      await insertBooking(inDays(5, 10, 30), 30, 'confirmed');

      expect(await rowCount()).toBe(2);
    });

    it('Given un rendez-vous annulé, When un chevauchement confirmé est inséré, Then il est accepté', async () => {
      await insertBooking(inDays(5, 10), 30, 'cancelled');
      await insertBooking(inDays(5, 10, 15), 30, 'confirmed');

      expect(await rowCount()).toBe(2);
    });

    it('Given un rendez-vous réservé puis annulé, When le même créneau est demandé, Then il est de nouveau réservable', async () => {
      const startsAt = inDays(6, 12).toISOString();
      const first = await service.create(
        aBookingRequest({ startsAt, email: 'a@example.com' }),
      );
      await db
        .update(bookings)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: 'visitor',
        })
        .where(eq(bookings.id, first.id));

      await expect(
        service.create(aBookingRequest({ startsAt, email: 'b@example.com' })),
      ).resolves.toEqual(expect.objectContaining({ startsAt }));
      expect(await rowCount()).toBe(2);
    });

    it('Given un rendez-vous annulé par le visiteur avec son jeton, When une nouvelle réservation vise le même horaire, Then elle réussit', async () => {
      const startsAt = inDays(6, 14).toISOString();
      const first = await service.create(
        aBookingRequest({ startsAt, email: 'a@example.com' }),
      );
      expect(notifier.bookingConfirmed).toHaveBeenCalledTimes(1);
      const [, token] = notifier.bookingConfirmed.mock.calls[0] as [
        unknown,
        string,
      ];

      await expect(service.cancelByVisitor(token)).resolves.toEqual({
        status: 'cancelled',
      });
      await expect(
        service.create(aBookingRequest({ startsAt, email: 'b@example.com' })),
      ).resolves.toEqual(expect.objectContaining({ startsAt }));

      const [cancelled] = await db
        .select()
        .from(bookings)
        .where(eq(bookings.id, first.id));
      expect(cancelled).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          cancelledBy: 'visitor',
        }),
      );
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
      expect(await rowCount()).toBe(2);
      expect(notifier.bookingCancelled).toHaveBeenCalledTimes(1);
    });

    it('Given le champ piège rempli, When la création arrive, Then rien n’est écrit en base', async () => {
      await service.create(
        aBookingRequest({
          startsAt: inDays(3, 12).toISOString(),
          website: 'https://spam.test',
        }),
      );

      expect(await rowCount()).toBe(0);
    });
  },
);

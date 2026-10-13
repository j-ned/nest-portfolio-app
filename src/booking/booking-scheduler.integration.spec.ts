import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { type Booking, bookings, schema } from '../database/schema';
import { BookingNotifier } from './booking-notifier.service';
import { BookingScheduler } from './booking-scheduler.service';
import { aBooking } from './booking-test-builders';

const ADMIN_URL = process.env.BOOKING_IT_DATABASE_URL;
// Base dédiée : les autres suites d'intégration vident la table booking en parallèle.
const DATABASE_NAME = 'booking_scheduler_it';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

(ADMIN_URL ? describe : describe.skip)('BookingScheduler on Postgres', () => {
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let db: Database;
  let scheduler: BookingScheduler;
  const notifier = { bookingReminder: jest.fn() };

  const fromNow = (ms: number): Date => new Date(Date.now() + ms);

  const insertBooking = async (
    startsIn: number,
    overrides: Partial<Booking> = {},
  ): Promise<string> => {
    const id = randomUUID();
    const startsAt = fromNow(startsIn);
    await db.insert(bookings).values(
      aBooking({
        id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        email: `${id}@example.com`,
        cancelTokenHash: id.replace(/-/g, '').padEnd(64, '0'),
        createdAt: fromNow(-2 * DAY),
        ...overrides,
      }),
    );
    return id;
  };

  const remindedIds = (): string[] =>
    (notifier.bookingReminder.mock.calls as [Booking][]).map(([row]) => row.id);

  const remainingIds = async (): Promise<string[]> =>
    (await db.select({ id: bookings.id }).from(bookings))
      .map((row) => row.id)
      .sort();

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
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      providers: [
        BookingScheduler,
        { provide: DRIZZLE, useValue: db },
        { provide: BookingNotifier, useValue: notifier },
      ],
    }).compile();
    scheduler = module.get(BookingScheduler);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await client.end();
    await admin.unsafe(`drop database if exists ${DATABASE_NAME} with (force)`);
    await admin.end();
  });

  beforeEach(async () => {
    notifier.bookingReminder.mockReset();
    notifier.bookingReminder.mockResolvedValue(undefined);
    await db.delete(bookings);
  });

  describe('rappel la veille', () => {
    it('Given un rendez-vous dans 23 h réservé il y a deux jours, When deux passages du cron se chevauchent, Then un seul rappel part', async () => {
      const id = await insertBooking(23 * HOUR);

      await Promise.all([scheduler.sendReminders(), scheduler.sendReminders()]);

      expect(remindedIds()).toEqual([id]);
    });

    it('Given trois rendez-vous à rappeler, When deux passages se chevauchent, Then chacun est rappelé exactement une fois', async () => {
      const ids = [
        await insertBooking(20 * HOUR),
        await insertBooking(21 * HOUR),
        await insertBooking(22 * HOUR),
      ];

      await Promise.all([scheduler.sendReminders(), scheduler.sendReminders()]);

      expect(remindedIds().sort()).toEqual([...ids].sort());
    });

    it('Given un rendez-vous rappelé, When le cron repasse, Then il n’est pas rappelé de nouveau', async () => {
      const id = await insertBooking(23 * HOUR);

      await scheduler.sendReminders();
      await scheduler.sendReminders();

      expect(remindedIds()).toEqual([id]);
    });

    it('Given un rappel, Then le notifier reçoit la ligne complète marquée comme rappelée', async () => {
      const id = await insertBooking(23 * HOUR, {
        format: 'phone',
        videoUrl: null,
        phone: '+33 6 12 34 56 78',
      });

      await scheduler.sendReminders();

      const [[row]] = notifier.bookingReminder.mock.calls as [Booking][];
      expect(row).toEqual(
        expect.objectContaining({
          id,
          email: `${id}@example.com`,
          format: 'phone',
          phone: '+33 6 12 34 56 78',
          status: 'confirmed',
        }),
      );
      expect(row.startsAt).toBeInstanceOf(Date);
      expect(row.reminderSentAt).toBeInstanceOf(Date);
    });

    it('Given un rendez-vous dans 23 h réservé 25 h avant son début, When le cron passe, Then il n’est jamais rappelé', async () => {
      const id = await insertBooking(23 * HOUR, {
        createdAt: fromNow(-2 * HOUR),
      });

      await scheduler.sendReminders();

      expect(remindedIds()).toEqual([]);
      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(row.reminderSentAt).toBeNull();
    });

    it.each([
      ['réservé 31 h avant son début', -8 * HOUR, true],
      ['réservé 29 h avant son début', -6 * HOUR, false],
    ])(
      'Given un rendez-vous dans 23 h %s, When le cron passe, Then rappelé : %s',
      async (_case, createdIn, reminded) => {
        const id = await insertBooking(23 * HOUR, {
          createdAt: fromNow(createdIn),
        });

        await scheduler.sendReminders();

        expect(remindedIds()).toEqual(reminded ? [id] : []);
      },
    );

    it('Given un rendez-vous annulé dans 23 h, When le cron passe, Then il n’est pas rappelé', async () => {
      await insertBooking(23 * HOUR, {
        status: 'cancelled',
        cancelledAt: fromNow(-HOUR),
        cancelledBy: 'visitor',
      });

      await scheduler.sendReminders();

      expect(remindedIds()).toEqual([]);
    });

    it.each([
      ['dans 25 h', 25 * HOUR],
      ['commencé il y a 10 min', -10 * 60_000],
    ])(
      'Given un rendez-vous %s, When le cron passe, Then il n’est pas rappelé',
      async (_case, startsIn) => {
        await insertBooking(startsIn);

        await scheduler.sendReminders();

        expect(remindedIds()).toEqual([]);
      },
    );

    it('Given un envoi qui échoue, Then le rendez-vous reste marqué comme rappelé et le cron suivant ne le rejoue pas', async () => {
      const id = await insertBooking(23 * HOUR);
      notifier.bookingReminder.mockRejectedValueOnce(new Error('SMTP down'));

      await scheduler.sendReminders();
      await scheduler.sendReminders();

      expect(remindedIds()).toEqual([id]);
      const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
      expect(row.reminderSentAt).toBeInstanceOf(Date);
    });
  });

  describe('purge', () => {
    it('Given des rendez-vous terminés il y a 7 et 5 mois, When la purge passe, Then seul le plus ancien est supprimé', async () => {
      await insertBooking(-7 * MONTH, { createdAt: fromNow(-8 * MONTH) });
      const recent = await insertBooking(-5 * MONTH, {
        createdAt: fromNow(-6 * MONTH),
      });

      await scheduler.purgeExpired();

      expect(await remainingIds()).toEqual([recent]);
    });

    it('Given des rendez-vous terminés juste avant et juste après la limite des six mois, Then la limite est respectée au jour près', async () => {
      await insertBooking(-(6 * MONTH + 7 * DAY), {
        createdAt: fromNow(-7 * MONTH),
      });
      const kept = await insertBooking(-(6 * MONTH - 7 * DAY), {
        createdAt: fromNow(-7 * MONTH),
      });

      await scheduler.purgeExpired();

      expect(await remainingIds()).toEqual([kept]);
    });

    it('Given un rendez-vous annulé terminé il y a 7 mois, When la purge passe, Then il est supprimé aussi', async () => {
      await insertBooking(-7 * MONTH, {
        createdAt: fromNow(-8 * MONTH),
        status: 'cancelled',
        cancelledAt: fromNow(-7 * MONTH - DAY),
        cancelledBy: 'owner',
      });
      const upcoming = await insertBooking(3 * DAY);

      await scheduler.purgeExpired();

      expect(await remainingIds()).toEqual([upcoming]);
    });
  });
});

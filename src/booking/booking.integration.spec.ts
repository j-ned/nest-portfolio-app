import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BadRequestException,
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
import { publicHolidayName } from './french-public-holidays';
import { addDays, toParisDate } from './paris-time';
import { templateSlotsOn } from './resolve-day';

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

const PARIS_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

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
    let availability: AvailabilityService;
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
      availability = module.get(AvailabilityService);
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
      await db.execute(sql`delete from availability_override`);
      await db.execute(
        sql`insert into booking_setting (id, close_public_holidays) values ('main', false) on conflict (id) do update set close_public_holidays = excluded.close_public_holidays`,
      );
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

    it('Given les migrations jouées, Then la table booking_setting de 0024 existe avec sa contrainte de ligne unique', async () => {
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
        sql`select conname, contype from pg_constraint where conname = 'booking_setting_single_row'`,
      );

      expect(journal.entries.map((entry) => entry.tag)).toContain(
        '0024_booking_setting',
      );
      expect([...constraints]).toEqual([
        { conname: 'booking_setting_single_row', contype: 'c' },
      ]);
    });

    it('Given une seconde ligne de réglage, When elle est insérée en SQL direct, Then la contrainte booking_setting_single_row la refuse', async () => {
      const failure = await db
        .execute(
          sql`insert into booking_setting (id, close_public_holidays) values ('other', true)`,
        )
        .then(
          () => null,
          (err: unknown) => err,
        );

      const pgError = (failure as { cause?: unknown } | null)?.cause ?? failure;
      expect(pgError).toEqual(
        expect.objectContaining({
          code: '23514',
          constraint_name: 'booking_setting_single_row',
        }),
      );
    });

    it('Given aucune ligne de réglage, When readClosePublicHolidays, Then les fériés sont fermés par défaut', async () => {
      await db.execute(sql`delete from booking_setting`);

      await expect(availability.readClosePublicHolidays()).resolves.toBe(true);
    });

    it('Given une ligne de réglage à faux insérée en SQL direct, When readClosePublicHolidays, Then faux', async () => {
      await db.execute(sql`delete from booking_setting`);
      await db.execute(
        sql`insert into booking_setting (id, close_public_holidays) values ('main', false)`,
      );

      await expect(availability.readClosePublicHolidays()).resolves.toBe(false);
    });

    it('Given les migrations jouées, Then la table availability_override de 0025 existe avec sa contrainte de sorte', async () => {
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
        sql`select conname, contype from pg_constraint where conname = 'availability_override_kind_check'`,
      );

      expect(journal.entries.map((entry) => entry.tag)).toContain(
        '0025_availability_override',
      );
      expect([...constraints]).toEqual([
        { conname: 'availability_override_kind_check', contype: 'c' },
      ]);
    });

    describe('exceptions par date', () => {
      const overrideRows = async () => [
        ...(await db.execute<{ day: string; kind: string }>(
          sql`select day::text as day, kind from availability_override order by day`,
        )),
      ];
      const slotsOn = async (date: string) =>
        (await service.getSlots()).slots
          .map((slot) => slot.startsAt)
          .filter((startsAt) => toParisDate(new Date(startsAt)) === date);
      const nextPublicHoliday = (): string => {
        let date = addDays(toParisDate(new Date()), 1);
        while (publicHolidayName(date) === null) date = addDays(date, 1);
        return date;
      };

      it('Given un jour ouvert, When il est fermé, Then plus aucun créneau ce jour-là et une réservation y est refusée en 422 slot_unavailable', async () => {
        const day = toParisDate(inDays(5, 12));
        const before = await slotsOn(day);

        await expect(availability.setDayOpen(day, false)).resolves.toEqual(
          expect.objectContaining({ date: day, state: 'closed' }),
        );

        expect(before.length).toBeGreaterThan(0);
        expect(await slotsOn(day)).toEqual([]);
        expect(await overrideRows()).toEqual([{ day, kind: 'closed' }]);
        const refusal = await service
          .create(aBookingRequest({ startsAt: inDays(5, 12).toISOString() }))
          .then(
            () => null,
            (err: unknown) => err,
          );
        expect(errorCode(refusal)).toBe('slot_unavailable');
        expect(await rowCount()).toBe(0);
      });

      it('Given un jour fermé à la main, When il est rouvert, Then ses créneaux reviennent et aucune exception ne reste en base', async () => {
        const day = toParisDate(inDays(5, 12));
        const before = await slotsOn(day);
        await availability.setDayOpen(day, false);

        await expect(availability.setDayOpen(day, true)).resolves.toEqual(
          expect.objectContaining({ date: day, state: 'open' }),
        );

        expect(await slotsOn(day)).toEqual(before);
        expect(await overrideRows()).toEqual([]);
      });

      it('Given la même fermeture écrite deux fois, Then une seule exception et deux réponses identiques', async () => {
        const day = toParisDate(inDays(6, 12));

        const first = await availability.setDayOpen(day, false);
        const second = await availability.setDayOpen(day, false);

        expect(second).toEqual(first);
        expect(await overrideRows()).toEqual([{ day, kind: 'closed' }]);
      });

      it('Given un jour ordinaire sans exception, When il est rouvert deux fois, Then aucune erreur et aucune exception écrite', async () => {
        const day = toParisDate(inDays(6, 12));

        await availability.setDayOpen(day, true);
        await expect(availability.setDayOpen(day, true)).resolves.toEqual(
          expect.objectContaining({ date: day, state: 'open' }),
        );

        expect(await overrideRows()).toEqual([]);
      });

      it('Given les fériés fermés, When le prochain férié est rouvert puis refermé, Then une exception open, puis plus aucune', async () => {
        await db.execute(
          sql`update booking_setting set close_public_holidays = true where id = 'main'`,
        );
        const holiday = nextPublicHoliday();

        await expect(availability.setDayOpen(holiday, true)).resolves.toEqual(
          expect.objectContaining({
            date: holiday,
            state: 'open',
            holiday: publicHolidayName(holiday),
          }),
        );
        expect(await overrideRows()).toEqual([{ day: holiday, kind: 'open' }]);

        await expect(availability.setDayOpen(holiday, false)).resolves.toEqual(
          expect.objectContaining({ date: holiday, state: 'holiday' }),
        );
        expect(await overrideRows()).toEqual([]);
      });

      it('Given un jour couvert par une fermeture, Then 409 day_in_closure et aucune exception écrite', async () => {
        const day = toParisDate(inDays(7, 12));
        await db
          .insert(availabilityClosures)
          .values({ startsOn: day, endsOn: day, reason: null });

        const refusal = await availability.setDayOpen(day, false).then(
          () => null,
          (err: unknown) => err,
        );

        expect(refusal).toBeInstanceOf(ConflictException);
        expect(errorCode(refusal)).toBe('day_in_closure');
        expect(await overrideRows()).toEqual([]);
      });

      it('Given hier, Then 422 day_in_past et aucune exception écrite', async () => {
        const yesterday = addDays(toParisDate(new Date()), -1);

        const refusal = await availability.setDayOpen(yesterday, false).then(
          () => null,
          (err: unknown) => err,
        );

        expect(errorCode(refusal)).toBe('day_in_past');
        expect(await overrideRows()).toEqual([]);
      });
    });

    describe('calendrier du mois et réglage des fériés', () => {
      const ALL_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        startMinute: 0,
        endMinute: 1440,
      }));
      const nextPublicHoliday = (): string => {
        let date = addDays(toParisDate(new Date()), 1);
        while (publicHolidayName(date) === null) date = addDays(date, 1);
        return date;
      };
      const datesOfMonth = (month: string): string[] => {
        const dates: string[] = [];
        for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) {
          dates.push(d);
        }
        return dates;
      };
      const followingMonth = (month: string): string =>
        addDays(`${month}-28`, 7).slice(0, 7);
      const closeHolidays = () =>
        db.execute(
          sql`update booking_setting set close_public_holidays = true where id = 'main'`,
        );
      const settingRows = async () => [
        ...(await db.execute<{ id: string; close_public_holidays: boolean }>(
          sql`select id, close_public_holidays from booking_setting`,
        )),
      ];
      const slotsOn = async (date: string) =>
        (await service.getSlots()).slots.filter(
          (slot) => toParisDate(new Date(slot.startsAt)) === date,
        );

      it('Given des plages tous les jours, When le calendrier sans mois, Then le mois de Paris courant complet, jours passés avant aujourd’hui, autres ouverts', async () => {
        const today = toParisDate(new Date());
        const month = today.slice(0, 7);
        const dates = datesOfMonth(month);

        const calendar = await availability.getCalendar();

        expect(calendar).toEqual(
          expect.objectContaining({
            month,
            today,
            previousMonth: null,
            nextMonth: followingMonth(month),
            closePublicHolidays: false,
          }),
        );
        expect(calendar.days.map((day) => day.date)).toEqual(dates);
        expect(calendar.days.map((day) => day.state)).toEqual(
          dates.map((date) => (date < today ? 'past' : 'open')),
        );
      });

      it('Given une exception fermée, une fermeture et les fériés fermés, When le mois du prochain férié, Then chaque jour est résolu', async () => {
        await closeHolidays();
        const today = toParisDate(new Date());
        const holiday = nextPublicHoliday();
        const month = holiday.slice(0, 7);
        const [closedDay, closureDay, openDay] = datesOfMonth(month).filter(
          (date) => date > today && publicHolidayName(date) === null,
        );
        await availability.setDayOpen(closedDay, false);
        await db.insert(availabilityClosures).values({
          startsOn: closureDay,
          endsOn: closureDay,
          reason: 'Congés',
        });
        const resolved = (
          date: string,
          state: string,
          holidayName: string | null,
          closure: object | null,
        ) => ({
          date,
          state,
          holiday: holidayName,
          slotCount: templateSlotsOn(date, ALL_DAY).length,
          closure,
        });

        const calendar = await availability.getCalendar(month);

        const byDate = new Map(calendar.days.map((day) => [day.date, day]));
        expect(calendar.month).toBe(month);
        expect(calendar.closePublicHolidays).toBe(true);
        expect(
          [closedDay, closureDay, holiday, openDay].map((date) =>
            byDate.get(date),
          ),
        ).toEqual([
          resolved(closedDay, 'closed', null, null),
          resolved(closureDay, 'closed-period', null, {
            startsOn: closureDay,
            endsOn: closureDay,
            reason: 'Congés',
          }),
          resolved(holiday, 'holiday', publicHolidayName(holiday), null),
          resolved(openDay, 'open', null, null),
        ]);
      });

      it('Given les fériés fermés, When l’interrupteur est coupé puis remis, Then le prochain férié s’ouvre puis se referme, sur une seule ligne de réglage', async () => {
        await closeHolidays();
        const holiday = nextPublicHoliday();
        const month = holiday.slice(0, 7);
        const holidayDay = async () =>
          (await availability.getCalendar(month)).days.find(
            (day) => day.date === holiday,
          );

        await expect(availability.setClosePublicHolidays(false)).resolves.toBe(
          false,
        );
        expect(await holidayDay()).toEqual(
          expect.objectContaining({
            state: 'open',
            holiday: publicHolidayName(holiday),
          }),
        );
        await expect(availability.setClosePublicHolidays(true)).resolves.toBe(
          true,
        );
        expect(await holidayDay()).toEqual(
          expect.objectContaining({
            state: 'holiday',
            holiday: publicHolidayName(holiday),
          }),
        );
        expect(await settingRows()).toEqual([
          { id: 'main', close_public_holidays: true },
        ]);
      });

      it('Given aucune ligne de réglage, When l’interrupteur est coupé, Then la ligne main est créée et relue fausse', async () => {
        await db.execute(sql`delete from booking_setting`);

        await availability.setClosePublicHolidays(false);

        await expect(availability.readClosePublicHolidays()).resolves.toBe(
          false,
        );
        expect(await settingRows()).toEqual([
          { id: 'main', close_public_holidays: false },
        ]);
      });

      it('Given les fériés fermés et le 11 novembre 2027 dans la fenêtre, When l’interrupteur est coupé, Then ses créneaux publics reviennent', async () => {
        jest.useFakeTimers({
          now: new Date('2027-11-06T08:00:00Z'),
          doNotFake: [
            'hrtime',
            'nextTick',
            'performance',
            'queueMicrotask',
            'setImmediate',
            'clearImmediate',
            'setInterval',
            'clearInterval',
            'setTimeout',
            'clearTimeout',
          ],
        });
        try {
          await closeHolidays();
          const closed = await slotsOn('2027-11-11');

          await availability.setClosePublicHolidays(false);

          expect(closed).toEqual([]);
          expect(await slotsOn('2027-11-11')).toHaveLength(48);
        } finally {
          jest.useRealTimers();
        }
      });
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
    it('Given des plages remplacées, Then les créneaux libres suivent aussitôt le nouveau bloc', async () => {
      const everyDay = (startMinute: number, endMinute: number) =>
        [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startMinute,
          endMinute,
        }));
      const parisTimes = async () =>
        new Set(
          (await service.getSlots()).slots.map((slot) =>
            PARIS_TIME.format(new Date(slot.startsAt)),
          ),
        );

      await availability.replaceRules(everyDay(600, 660));
      const morning = await parisTimes();
      await availability.replaceRules(everyDay(840, 900));
      const afternoon = await parisTimes();

      expect([...morning].sort()).toEqual(['10:00', '10:30']);
      expect([...afternoon].sort()).toEqual(['14:00', '14:30']);
      expect(await db.select().from(availabilityRules)).toHaveLength(7);
    });

    it('Given des plages qui se chevauchent, Then le remplacement est refusé et l’ancien bloc reste intact', async () => {
      const failure = await availability
        .replaceRules([
          { weekday: 1, startMinute: 540, endMinute: 720 },
          { weekday: 1, startMinute: 660, endMinute: 780 },
        ])
        .then(
          () => null,
          (err: unknown) => err,
        );

      expect(failure).toBeInstanceOf(BadRequestException);
      expect(await db.select().from(availabilityRules)).toHaveLength(7);
    });

    it('Given un rendez-vous annulé par le propriétaire, Then il porte le motif, le visiteur est prévenu et le créneau est de nouveau réservable', async () => {
      const startsAt = inDays(7, 12).toISOString();
      const first = await service.create(
        aBookingRequest({ startsAt, email: 'a@example.com' }),
      );

      await expect(
        service.cancelByOwner(first.id, 'Imprévu de mon côté.'),
      ).resolves.toEqual(
        expect.objectContaining({
          id: first.id,
          status: 'cancelled',
          cancelledBy: 'owner',
          cancelReason: 'Imprévu de mon côté.',
        }),
      );
      await expect(
        service.create(aBookingRequest({ startsAt, email: 'b@example.com' })),
      ).resolves.toEqual(expect.objectContaining({ startsAt }));

      expect(notifier.bookingCancelled).toHaveBeenCalledTimes(1);
      expect(notifier.bookingCancelled).toHaveBeenCalledWith(
        expect.objectContaining({
          id: first.id,
          cancelledBy: 'owner',
          cancelReason: 'Imprévu de mon côté.',
        }),
      );
      expect(await rowCount()).toBe(2);
    });

    it('Given des rendez-vous passés, à venir et annulés, Then les listes admin et le compteur les répartissent', async () => {
      const later = await service.create(
        aBookingRequest({
          startsAt: inDays(9, 12).toISOString(),
          email: 'a@example.com',
        }),
      );
      const sooner = await service.create(
        aBookingRequest({
          startsAt: inDays(8, 12).toISOString(),
          email: 'b@example.com',
        }),
      );
      await service.cancelByOwner(later.id, undefined);
      await insertBooking(inDays(-3, 9), 30, 'confirmed');
      await insertBooking(inDays(-2, 9), 30, 'confirmed');

      const upcoming = await service.listBookings('upcoming');
      const past = await service.listBookings('past');

      expect(upcoming.map((row) => row.id)).toEqual([sooner.id, later.id]);
      expect(upcoming.map((row) => row.status)).toEqual([
        'confirmed',
        'cancelled',
      ]);
      expect(past.map((row) => row.startsAt)).toEqual([
        inDays(-2, 9).toISOString(),
        inDays(-3, 9).toISOString(),
      ]);
      await expect(service.countUpcoming()).resolves.toEqual({ count: 1 });
    });
  },
);

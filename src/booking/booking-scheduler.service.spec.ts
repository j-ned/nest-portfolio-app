import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../database/drizzle.constants';
import { bookings } from '../database/schema';
import { createMockDb } from '../database/test-utils';
import { BookingNotifier } from './booking-notifier.service';
import { BOOKING_POLICY } from './booking-policy';
import { BookingScheduler } from './booking-scheduler.service';
import { aBooking } from './booking-test-builders';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<typeof import('@sentry/nestjs')>('@sentry/nestjs'),
  SentryCron: jest.fn(
    () => (_target: unknown, _key: unknown, descriptor: unknown) => descriptor,
  ),
}));

const SENTRY_CRON_CALLS: [string, Record<string, unknown>][] = [
  ...(
    Sentry.SentryCron as unknown as jest.Mock<
      unknown,
      [string, Record<string, unknown>]
    >
  ).mock.calls,
];

const render = (fragment: unknown) =>
  new PgDialect({ casing: 'snake_case' }).sqlToQuery(fragment as SQL);

const NOW = new Date('2026-10-13T03:30:00Z');

const DUE_VIDEO = aBooking({
  id: '11111111-1111-4111-8111-111111111111',
  startsAt: new Date('2026-10-14T01:00:00Z'),
  endsAt: new Date('2026-10-14T01:30:00Z'),
  name: 'Camille Martin',
  email: 'camille@example.com',
  reminderSentAt: NOW,
});
const DUE_PHONE = aBooking({
  id: '22222222-2222-4222-8222-222222222222',
  startsAt: new Date('2026-10-14T02:00:00Z'),
  endsAt: new Date('2026-10-14T02:30:00Z'),
  name: 'Dominique Durand',
  email: 'dominique@example.com',
  format: 'phone',
  videoUrl: null,
  phone: '+33 6 98 76 54 32',
  reminderSentAt: NOW,
});
const PERSONAL_VALUES = [
  DUE_VIDEO.name,
  DUE_VIDEO.email,
  DUE_VIDEO.videoUrl ?? '',
  DUE_VIDEO.cancelTokenHash,
  DUE_PHONE.name,
  DUE_PHONE.email,
  DUE_PHONE.phone ?? '',
];

describe('BookingScheduler', () => {
  let scheduler: BookingScheduler;
  let db: ReturnType<typeof createMockDb>;
  let notifier: { bookingReminder: jest.Mock };
  let logged: Record<'log' | 'warn' | 'error', jest.SpyInstance>;

  const loggedText = (): string =>
    Object.values(logged)
      .flatMap((spy) => spy.mock.calls as unknown[][])
      .map((args) => JSON.stringify(args))
      .join('\n');

  beforeEach(async () => {
    db = createMockDb();
    notifier = { bookingReminder: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        BookingScheduler,
        { provide: DRIZZLE, useValue: db },
        { provide: BookingNotifier, useValue: notifier },
      ],
    }).compile();
    scheduler = module.get(BookingScheduler);
    logged = {
      log: jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {}),
      warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {}),
    };
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('planification', () => {
    it.each([
      ['sendReminders', 'booking-reminders', '*/15 * * * *'],
      ['purgeExpired', 'booking-purge', '30 3 * * *'],
    ] as const)(
      '%s est planifié par @Cron en UTC et surveillé par Sentry sous le nom %s, au même rythme %s',
      (method, slug, cronTime) => {
        // Lecture des métadonnées du handler, jamais appelé : pas de `this` en jeu
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const handler = BookingScheduler.prototype[method];

        expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, handler)).toEqual(
          expect.objectContaining({ cronTime, timeZone: 'UTC' }),
        );
        expect(SENTRY_CRON_CALLS.filter(([name]) => name === slug)).toEqual([
          [
            slug,
            expect.objectContaining({
              schedule: { type: 'crontab', value: cronTime },
              timezone: 'UTC',
            }),
          ],
        ]);
      },
    );
  });

  describe('sendReminders', () => {
    it('Given deux rendez-vous à rappeler, Then ils sont réclamés par une seule mise à jour, sans lecture préalable, puis rappelés chacun une fois', async () => {
      db.returning.mockResolvedValueOnce([DUE_VIDEO, DUE_PHONE]);

      await scheduler.sendReminders();

      expect(db.select).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.update).toHaveBeenCalledWith(bookings);
      expect(db.returning).toHaveBeenCalledTimes(1);
      expect(notifier.bookingReminder.mock.calls).toEqual([
        [DUE_VIDEO],
        [DUE_PHONE],
      ]);
    });

    it('Given une réclamation, Then elle ne pose que reminder_sent_at, avant tout envoi', async () => {
      db.returning.mockResolvedValueOnce([DUE_VIDEO]);

      await scheduler.sendReminders();

      const [values] = db.set.mock.calls[0] as [Record<string, unknown>];
      expect(Object.keys(values)).toEqual(['reminderSentAt']);
      expect(values.reminderSentAt).not.toBeNull();
      expect(db.returning.mock.invocationCallOrder[0]).toBeLessThan(
        notifier.bookingReminder.mock.invocationCallOrder[0],
      );
    });

    it('Given une réclamation, Then elle ne vise que les rendez-vous confirmés, jamais rappelés, selon leur début et leur date de réservation', async () => {
      db.returning.mockResolvedValueOnce([]);

      await scheduler.sendReminders();

      const where = render((db.where.mock.calls as unknown[][])[0][0]);
      expect(where.sql).toContain('"status" =');
      expect(where.params).toContain('confirmed');
      expect(where.sql).toContain('"reminder_sent_at" is null');
      expect(where.sql).toContain('"starts_at"');
      expect(where.sql).toContain('"created_at"');
    });

    it('Given la politique, Then les bornes du rappel en sont dérivées par paramètres SQL, sans littéral', async () => {
      db.returning.mockResolvedValueOnce([]);

      await scheduler.sendReminders();

      const where = render((db.where.mock.calls as unknown[][])[0][0]);
      expect(where.sql).toMatch(
        /"booking"\."starts_at" <= now\(\) \+ make_interval\(hours => \$(\d+)\)/,
      );
      expect(where.sql).toMatch(
        /"booking"\."created_at" <= "booking"\."starts_at" - make_interval\(hours => \$(\d+)\)/,
      );
      const leadIndex = Number(
        /now\(\) \+ make_interval\(hours => \$(\d+)\)/.exec(where.sql)?.[1],
      );
      const aheadIndex = Number(
        /- make_interval\(hours => \$(\d+)\)/.exec(where.sql)?.[1],
      );
      expect(where.params[leadIndex - 1]).toBe(
        BOOKING_POLICY.reminderLeadHours,
      );
      expect(where.params[aheadIndex - 1]).toBe(
        BOOKING_POLICY.reminderMinCreatedAheadHours,
      );
      expect(where.sql).not.toContain("interval '");
    });

    it('Given aucun rendez-vous à rappeler, Then aucun email', async () => {
      db.returning.mockResolvedValueOnce([]);

      await scheduler.sendReminders();

      expect(notifier.bookingReminder).not.toHaveBeenCalled();
    });

    it('Given un envoi qui échoue, Then les autres rappels partent quand même et le passage se termine sans erreur', async () => {
      db.returning.mockResolvedValueOnce([DUE_VIDEO, DUE_PHONE]);
      notifier.bookingReminder.mockRejectedValueOnce(new Error('SMTP down'));

      await expect(scheduler.sendReminders()).resolves.toBeUndefined();

      expect(notifier.bookingReminder).toHaveBeenCalledTimes(2);
      expect(notifier.bookingReminder).toHaveBeenLastCalledWith(DUE_PHONE);
    });

    it('Given un envoi qui échoue, Then l’échec est journalisé avec l’id, sans donnée personnelle ni empreinte du jeton', async () => {
      db.returning.mockResolvedValueOnce([DUE_VIDEO, DUE_PHONE]);
      notifier.bookingReminder.mockRejectedValueOnce(
        new Error('SMTP down for camille@example.com'),
      );

      await scheduler.sendReminders();

      expect(logged.error).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.error.mock.calls[0])).toContain(
        DUE_VIDEO.id,
      );
      for (const value of PERSONAL_VALUES) {
        expect(loggedText()).not.toContain(value);
      }
    });

    it('Given un envoi qui échoue, Then la réclamation n’est pas défaite : le rappel ne sera pas rejoué', async () => {
      db.returning.mockResolvedValueOnce([DUE_VIDEO]);
      notifier.bookingReminder.mockRejectedValueOnce(new Error('SMTP down'));

      await scheduler.sendReminders();

      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('Given des rappels envoyés, Then aucune donnée personnelle n’est journalisée', async () => {
      db.returning.mockResolvedValueOnce([DUE_VIDEO, DUE_PHONE]);

      await scheduler.sendReminders();

      for (const value of PERSONAL_VALUES) {
        expect(loggedText()).not.toContain(value);
      }
    });
  });

  describe('purgeExpired', () => {
    const deletedRows = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      }));

    it('Given des rendez-vous terminés il y a plus de six mois, Then ils sont supprimés quel que soit leur statut', async () => {
      db.returning.mockResolvedValueOnce(deletedRows(2));

      await scheduler.purgeExpired();

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(db.delete).toHaveBeenCalledWith(bookings);
      const where = render((db.where.mock.calls as unknown[][])[0][0]);
      expect(where.sql).toContain('"ends_at" <');
      expect(where.sql).not.toContain('"status"');
    });

    it('Given la politique, Then l’ancienneté de purge en est dérivée par paramètre SQL, sans littéral', async () => {
      db.returning.mockResolvedValueOnce([]);

      await scheduler.purgeExpired();

      const where = render((db.where.mock.calls as unknown[][])[0][0]);
      expect(where.sql).toContain('make_interval(months => $1)');
      expect(where.params).toEqual([BOOKING_POLICY.retentionMonths]);
      expect(where.sql).not.toContain("interval '");
    });

    it('Given onze rendez-vous supprimés, Then le nombre est journalisé', async () => {
      db.returning.mockResolvedValueOnce(deletedRows(11));

      await scheduler.purgeExpired();

      expect(logged.log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.log.mock.calls[0])).toMatch(/\b11\b/);
    });

    it('Given aucun rendez-vous à purger, Then zéro est journalisé', async () => {
      db.returning.mockResolvedValueOnce([]);

      await scheduler.purgeExpired();

      expect(logged.log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.log.mock.calls[0])).toMatch(/\b0\b/);
    });
  });
});

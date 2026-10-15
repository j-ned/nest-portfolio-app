import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getTableName, is, SQL, type Table } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { BookingFeedService } from './booking-feed.service';
import { BOOKING_POLICY } from './booking-policy';
import { aBooking } from './booking-test-builders';
import { deriveFeedToken } from './feed-token';

const SECRET = 'a'.repeat(32);
const SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER_SALT = 'BBBBBBBBBBBBBBBBBBBBBB';
const TOKEN = deriveFeedToken(SECRET, SALT);

const render = (fragment: unknown) =>
  new PgDialect({ casing: 'snake_case' }).sqlToQuery(fragment as SQL);

const serialize = (value: unknown): string => {
  if (is(value, SQL)) {
    const { sql, params } = render(value);
    return JSON.stringify({ sql, params });
  }
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, inner: unknown) => {
      if (typeof inner === 'object' && inner !== null) {
        if (seen.has(inner)) return undefined;
        seen.add(inner);
      }
      return inner;
    }) ?? String(value)
  );
};

const UPCOMING = aBooking({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Marie Dupont',
  startsAt: new Date('2026-11-04T10:00:00Z'),
  endsAt: new Date('2026-11-04T10:30:00Z'),
});
const LATER = aBooking({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Camille Martin',
  startsAt: new Date('2026-11-05T10:00:00Z'),
  endsAt: new Date('2026-11-05T10:30:00Z'),
});

describe('BookingFeedService', () => {
  let service: BookingFeedService;
  let db: ReturnType<typeof createMockDb>;
  let config: { bookingFeedSecret: string | undefined; publicSiteUrl: string };

  const dbCalls = (): number =>
    Object.values(db).reduce(
      (total, mock) => total + mock.mock.calls.length,
      0,
    );
  const allQueryArguments = (): string =>
    Object.values(db)
      .flatMap((mock) => mock.mock.calls as unknown[][])
      .flat()
      .map(serialize)
      .join('\n');

  beforeEach(async () => {
    db = createMockDb();
    config = {
      bookingFeedSecret: SECRET,
      publicSiteUrl: 'https://nedellec-julien.fr',
    };
    const module = await Test.createTestingModule({
      providers: [
        BookingFeedService,
        { provide: DRIZZLE, useValue: db },
        { provide: AppConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(BookingFeedService);
  });

  describe('renderFeed', () => {
    it('Given aucun secret configuré, When un jeton bien formé est présenté, Then null sans aucune requête', async () => {
      config.bookingFeedSecret = undefined;

      await expect(service.renderFeed(`${TOKEN}.ics`)).resolves.toBeNull();
      expect(dbCalls()).toBe(0);
    });

    it.each([
      ['sans suffixe', TOKEN],
      ['trop court', `${TOKEN.slice(0, 42)}.ics`],
      ['vide', ''],
      ['avec un /', `${TOKEN.slice(0, 20)}/${TOKEN.slice(21)}.ics`],
    ])(
      'Given un fichier malformé (%s), Then null sans aucune requête',
      async (_case, file) => {
        await expect(service.renderFeed(file)).resolves.toBeNull();
        expect(dbCalls()).toBe(0);
      },
    );

    it.each([
      ['aucune ligne de réglage', []],
      ['un réglage sans sel', [{ feedSalt: null }]],
    ])(
      'Given %s, When un jeton bien formé est présenté, Then null sans lire les rendez-vous',
      async (_case, rows) => {
        db.limit.mockResolvedValueOnce(rows);

        await expect(service.renderFeed(`${TOKEN}.ics`)).resolves.toBeNull();
        expect(db.orderBy).not.toHaveBeenCalled();
      },
    );

    it('Given le sel lu, Then il est lu dans la ligne main de booking_setting', async () => {
      db.limit.mockResolvedValueOnce([{ feedSalt: SALT }]);
      db.orderBy.mockResolvedValueOnce([]);

      await service.renderFeed(`${TOKEN}.ics`);

      expect(db.from).toHaveBeenCalledTimes(2);
      const [table] = db.from.mock.calls[0] as [Table];
      expect(getTableName(table)).toBe('booking_setting');
      expect(render((db.where.mock.calls as unknown[][])[0][0]).params).toEqual(
        ['main'],
      );
    });

    it('Given un jeton dérivé d’un autre sel, Then null sans lire les rendez-vous', async () => {
      db.limit.mockResolvedValueOnce([{ feedSalt: OTHER_SALT }]);

      await expect(service.renderFeed(`${TOKEN}.ics`)).resolves.toBeNull();
      expect(db.orderBy).not.toHaveBeenCalled();
    });

    it('Given un jeton dérivé d’un autre secret, Then null', async () => {
      db.limit.mockResolvedValueOnce([{ feedSalt: SALT }]);
      const foreign = deriveFeedToken('b'.repeat(32), SALT);

      await expect(service.renderFeed(`${foreign}.ics`)).resolves.toBeNull();
      expect(db.orderBy).not.toHaveBeenCalled();
    });

    it('Given le bon jeton, Then le flux iCalendar des rendez-vous lus, dans l’ordre de la requête', async () => {
      db.limit.mockResolvedValueOnce([{ feedSalt: SALT }]);
      db.orderBy.mockResolvedValueOnce([UPCOMING, LATER]);

      const feed = await service.renderFeed(`${TOKEN}.ics`);

      expect(feed?.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(feed).toContain('X-WR-CALNAME:Rendez-vous nedellec-julien.fr\r\n');
      expect(
        (feed ?? '').split('\r\n').filter((line) => line.startsWith('UID:')),
      ).toEqual([`UID:${UPCOMING.id}`, `UID:${LATER.id}`]);
    });

    it('Given le bon jeton, Then seuls les rendez-vous confirmés finis depuis moins de la rétention sont demandés, triés par début', async () => {
      db.limit.mockResolvedValueOnce([{ feedSalt: SALT }]);
      db.orderBy.mockResolvedValueOnce([]);

      await service.renderFeed(`${TOKEN}.ics`);

      expect(db.from).toHaveBeenCalledTimes(2);
      const [table] = db.from.mock.calls[1] as [Table];
      expect(getTableName(table)).toBe('booking');
      const where = render((db.where.mock.calls as unknown[][])[1][0]);
      expect(where.sql).toContain(
        '"ends_at" > now() - make_interval(months => $',
      );
      expect(where.sql).toContain('"status" = $');
      expect(where.params).toEqual(
        expect.arrayContaining(['confirmed', BOOKING_POLICY.retentionMonths]),
      );
      expect(where.sql).not.toContain("interval '");
      const order = (db.orderBy.mock.calls[0] as unknown[]).map(serialize);
      expect(order.join(' ')).toContain('starts_at');
    });

    it('Given une origine publique avec une barre finale, Then le lien Gérer n’a pas de double barre', async () => {
      config.publicSiteUrl = 'https://nedellec-julien.fr/';
      db.limit.mockResolvedValueOnce([{ feedSalt: SALT }]);
      db.orderBy.mockResolvedValueOnce([UPCOMING]);

      const feed = await service.renderFeed(`${TOKEN}.ics`);

      expect((feed ?? '').replace(/\r\n[ \t]/g, '')).toContain(
        '\\nGérer : https://nedellec-julien.fr/admin/rendez-vous',
      );
    });

    it.each([
      ['valide', TOKEN, [{ feedSalt: SALT }]],
      ['faux', deriveFeedToken(SECRET, OTHER_SALT), [{ feedSalt: SALT }]],
    ])(
      'Given un jeton %s, Then il n’apparaît dans aucun argument de requête',
      async (_case, token, settingRows) => {
        db.limit.mockResolvedValueOnce(settingRows);
        db.orderBy.mockResolvedValueOnce([UPCOMING]);

        await service.renderFeed(`${token}.ics`);

        expect(dbCalls()).toBeGreaterThan(0);
        expect(allQueryArguments()).not.toContain(token);
      },
    );
  });

  describe('regenerate', () => {
    it('Given aucun secret configuré, Then 409 feed_not_configured sans aucune écriture', async () => {
      config.bookingFeedSecret = undefined;

      const rejection = await service.regenerate().then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(rejection).toBeInstanceOf(ConflictException);
      expect((rejection as ConflictException).getResponse()).toEqual({
        error: 'feed_not_configured',
        message: 'Abonnement non configuré.',
      });
      expect(dbCalls()).toBe(0);
    });

    it('Given un secret, Then un nouveau sel est écrit sur la ligne main, et le jeton qui en dérive est rendu actif avec sa date', async () => {
      const createdAt = new Date('2026-10-15T08:32:00.000Z');
      db.returning.mockResolvedValueOnce([{ feedCreatedAt: createdAt }]);

      const subscription = await service.regenerate();

      expect(db.insert).toHaveBeenCalledTimes(1);
      const [table] = db.insert.mock.calls[0] as [Table];
      expect(getTableName(table)).toBe('booking_setting');
      const [values] = db.values.mock.calls[0] as [Record<string, unknown>];
      expect(values.id).toBe('main');
      expect(values.feedSalt).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(values).not.toHaveProperty('closePublicHolidays');
      expect(subscription).toEqual({
        status: 'active',
        token: deriveFeedToken(SECRET, values.feedSalt as string),
        createdAt: '2026-10-15T08:32:00.000Z',
      });
    });

    it('Given une ligne existante, Then l’upsert remplace le sel et sa date sans toucher au réglage des fériés', async () => {
      db.returning.mockResolvedValueOnce([{ feedCreatedAt: new Date() }]);

      await service.regenerate();

      expect(db.onConflictDoUpdate).toHaveBeenCalledTimes(1);
      const [values] = db.values.mock.calls[0] as [Record<string, unknown>];
      const [conflict] = db.onConflictDoUpdate.mock.calls[0] as [
        { target: { name: string }; set: Record<string, unknown> },
      ];
      expect(conflict.target.name).toBe('id');
      expect(Object.keys(conflict.set).sort()).toEqual([
        'feedCreatedAt',
        'feedSalt',
        'updatedAt',
      ]);
      expect(conflict.set.feedSalt).toBe(values.feedSalt);
    });

    it('Given deux régénérations, Then deux sels et deux jetons différents', async () => {
      db.returning
        .mockResolvedValueOnce([{ feedCreatedAt: new Date() }])
        .mockResolvedValueOnce([{ feedCreatedAt: new Date() }]);

      const first = await service.regenerate();
      const second = await service.regenerate();

      const salts = (db.values.mock.calls as [{ feedSalt: string }][]).map(
        ([values]) => values.feedSalt,
      );
      expect(salts[0]).not.toBe(salts[1]);
      expect(first.token).not.toBe(second.token);
    });
  });
});

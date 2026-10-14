import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getTableName, type SQL, type Table } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../database/drizzle.constants';
import type { DbExecutor } from '../database/drizzle.types';
import { availabilityClosures, availabilityRules } from '../database/schema';
import { createMockDb } from '../database/test-utils';
import { AvailabilityService } from './availability.service';
import {
  anAvailabilityClosure,
  anAvailabilityRule,
} from './booking-test-builders';

const render = (fragment: unknown) =>
  new PgDialect({ casing: 'snake_case' }).sqlToQuery(fragment as SQL);

describe('AvailabilityService (lecture)', () => {
  let service: AvailabilityService;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AvailabilityService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(AvailabilityService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('listRules', () => {
    it('Given des plages en base, When listRules, Then elles sont rendues telles que lues', async () => {
      const rules = [
        anAvailabilityRule({ weekday: 1, startMinute: 540, endMinute: 720 }),
        anAvailabilityRule({ weekday: 3, startMinute: 840, endMinute: 1080 }),
      ];
      db.orderBy.mockResolvedValueOnce(rules);

      await expect(service.listRules()).resolves.toEqual(rules);
    });
  });

  describe('listClosures', () => {
    it.each([
      ['2026-10-25T22:30:00Z', '2026-10-25'],
      ['2026-10-25T23:30:00Z', '2026-10-26'],
    ])(
      'Given il est %s, When listClosures, Then seules les fermetures finissant le %s (date de Paris) ou après sont lues',
      async (now, parisToday) => {
        jest.useFakeTimers().setSystemTime(new Date(now));
        const closures = [
          anAvailabilityClosure({ startsOn: parisToday, endsOn: parisToday }),
        ];
        db.orderBy.mockResolvedValueOnce(closures);

        await expect(service.listClosures()).resolves.toEqual(closures);
        expect(db.where).toHaveBeenCalledTimes(1);
        const [condition] = db.where.mock.calls[0] as [unknown];
        expect(render(condition).params).toEqual([parisToday]);
      },
    );
  });

  describe('readClosePublicHolidays', () => {
    it.each([
      ['aucune ligne de réglage', [], true],
      ['un réglage à faux', [{ closePublicHolidays: false }], false],
      ['un réglage à vrai', [{ closePublicHolidays: true }], true],
    ])(
      'Given %s (%j), When readClosePublicHolidays, Then %s',
      async (_case, rows, expected) => {
        db.limit.mockResolvedValueOnce(rows);

        await expect(service.readClosePublicHolidays()).resolves.toBe(expected);
      },
    );

    it('Given la ligne unique du réglage, Then elle est lue dans booking_setting par son id main', async () => {
      db.limit.mockResolvedValueOnce([{ closePublicHolidays: false }]);

      await service.readClosePublicHolidays();

      const [table] = db.from.mock.calls[0] as [Table];
      expect(getTableName(table)).toBe('booking_setting');
      const [condition] = db.where.mock.calls[0] as [unknown];
      expect(render(condition).params).toEqual(['main']);
    });

    it('Given un exécuteur de transaction, Then le réglage est lu par lui, jamais par la connexion partagée', async () => {
      const tx = createMockDb();
      tx.limit.mockResolvedValueOnce([{ closePublicHolidays: false }]);

      await expect(
        service.readClosePublicHolidays(tx as unknown as DbExecutor),
      ).resolves.toBe(false);
      expect(tx.select).toHaveBeenCalledTimes(1);
      expect(db.select).not.toHaveBeenCalled();
    });
  });
});

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (err: unknown) => err,
  );

const businessError = (err: unknown): unknown =>
  (err as { getResponse(): { error?: unknown } }).getResponse().error;

const ruleWindows = (
  rows: { weekday: number; startMinute: number; endMinute: number }[],
) =>
  rows.map(({ weekday, startMinute, endMinute }) => ({
    weekday,
    startMinute,
    endMinute,
  }));

describe('AvailabilityService (écriture)', () => {
  let service: AvailabilityService;
  let db: ReturnType<typeof createMockDb>;
  let tx: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    db = createMockDb();
    tx = createMockDb();
    db.transaction.mockImplementation((fn: (t: unknown) => unknown) =>
      Promise.resolve(fn(tx)),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [AvailabilityService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(AvailabilityService);
  });

  describe('replaceRules', () => {
    const MONDAY_AFTERNOON = { weekday: 1, startMinute: 840, endMinute: 1080 };
    const MONDAY_MORNING = { weekday: 1, startMinute: 540, endMinute: 720 };
    const SUNDAY_ALL_DAY = { weekday: 7, startMinute: 0, endMinute: 1440 };
    const UNSORTED = [SUNDAY_ALL_DAY, MONDAY_AFTERNOON, MONDAY_MORNING];
    const SORTED = [MONDAY_MORNING, MONDAY_AFTERNOON, SUNDAY_ALL_DAY];

    const givenStored = () => {
      tx.returning.mockResolvedValueOnce(
        UNSORTED.map((rule) => anAvailabilityRule(rule)),
      );
      tx.orderBy.mockResolvedValueOnce(
        SORTED.map((rule) => anAvailabilityRule(rule)),
      );
    };

    it('Given des plages valides, Then l’ancien bloc est supprimé puis le nouveau inséré, dans une même transaction', async () => {
      givenStored();

      await service.replaceRules(UNSORTED);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.delete).toHaveBeenCalledWith(availabilityRules);
      expect(tx.insert).toHaveBeenCalledWith(availabilityRules);
      expect(tx.delete.mock.invocationCallOrder[0]).toBeLessThan(
        tx.insert.mock.invocationCallOrder[0],
      );
      const [values] = tx.values.mock.calls[0] as [
        { weekday: number; startMinute: number; endMinute: number }[],
      ];
      expect(ruleWindows(values)).toEqual(expect.arrayContaining(UNSORTED));
      expect(values).toHaveLength(3);
    });

    it('Given des plages valides, Then aucune écriture ne passe hors de la transaction', async () => {
      givenStored();

      await service.replaceRules(UNSORTED);

      expect(db.delete).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('Given des plages fournies dans le désordre, Then elles sont rendues triées par jour puis par début', async () => {
      givenStored();

      const stored = await service.replaceRules(UNSORTED);

      expect(ruleWindows(stored)).toEqual(SORTED);
    });

    it('Given une liste vide, Then toutes les plages sont supprimées, rien n’est inséré, la réponse est vide', async () => {
      tx.orderBy.mockResolvedValueOnce([]);

      const stored = await service.replaceRules([]);

      expect(tx.delete).toHaveBeenCalledWith(availabilityRules);
      expect(tx.insert).not.toHaveBeenCalled();
      expect(stored).toEqual([]);
    });

    it.each([
      [
        'un chevauchement partiel',
        [
          { weekday: 2, startMinute: 540, endMinute: 720 },
          { weekday: 2, startMinute: 660, endMinute: 780 },
        ],
      ],
      [
        'une plage contenue dans une autre',
        [
          { weekday: 2, startMinute: 540, endMinute: 720 },
          { weekday: 2, startMinute: 600, endMinute: 660 },
        ],
      ],
      [
        'deux plages identiques',
        [
          { weekday: 4, startMinute: 540, endMinute: 600 },
          { weekday: 4, startMinute: 540, endMinute: 600 },
        ],
      ],
      [
        'un chevauchement fourni dans le désordre',
        [
          { weekday: 5, startMinute: 840, endMinute: 960 },
          { weekday: 1, startMinute: 540, endMinute: 600 },
          { weekday: 5, startMinute: 540, endMinute: 870 },
        ],
      ],
    ])(
      'Given %s le même jour, Then 400 rules_overlap sans aucune écriture',
      async (_case, rules) => {
        const err = await rejectionOf(service.replaceRules(rules));

        expect(err).toBeInstanceOf(BadRequestException);
        expect(businessError(err)).toBe('rules_overlap');
        expect(db.transaction).not.toHaveBeenCalled();
        expect(tx.delete).not.toHaveBeenCalled();
        expect(db.delete).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        'deux plages adjacentes le même jour',
        [
          { weekday: 2, startMinute: 540, endMinute: 720 },
          { weekday: 2, startMinute: 720, endMinute: 840 },
        ],
      ],
      [
        'la même plage sur deux jours',
        [
          { weekday: 2, startMinute: 540, endMinute: 720 },
          { weekday: 3, startMinute: 540, endMinute: 720 },
        ],
      ],
    ])('Given %s, Then elles sont enregistrées', async (_case, rules) => {
      tx.returning.mockResolvedValueOnce(
        rules.map((rule) => anAvailabilityRule(rule)),
      );
      tx.orderBy.mockResolvedValueOnce(
        rules.map((rule) => anAvailabilityRule(rule)),
      );

      const stored = await service.replaceRules(rules);

      expect(ruleWindows(stored)).toEqual(rules);
      expect(tx.insert).toHaveBeenCalledWith(availabilityRules);
    });

    it.each([
      [
        'une fin égale au début',
        { weekday: 1, startMinute: 600, endMinute: 600 },
      ],
      [
        'une fin avant le début',
        { weekday: 1, startMinute: 600, endMinute: 540 },
      ],
    ])('Given %s, Then 400 sans aucune écriture', async (_case, rule) => {
      const err = await rejectionOf(service.replaceRules([rule]));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    });
  });

  describe('createClosure', () => {
    it('Given une fermeture avec motif, Then elle est insérée telle quelle et la ligne créée est rendue', async () => {
      const created = anAvailabilityClosure({
        startsOn: '2026-12-24',
        endsOn: '2026-12-26',
        reason: 'Noël',
      });
      db.returning.mockResolvedValueOnce([created]);

      await expect(
        service.createClosure({
          startsOn: '2026-12-24',
          endsOn: '2026-12-26',
          reason: 'Noël',
        }),
      ).resolves.toEqual(created);
      expect(db.insert).toHaveBeenCalledWith(availabilityClosures);
      expect(db.values).toHaveBeenCalledWith({
        startsOn: '2026-12-24',
        endsOn: '2026-12-26',
        reason: 'Noël',
      });
    });

    it.each([
      ['sans motif', undefined],
      ['avec un motif vide', ''],
    ])(
      'Given une fermeture %s, Then le motif est enregistré à null',
      async (_case, reason) => {
        db.returning.mockResolvedValueOnce([anAvailabilityClosure()]);

        await service.createClosure({
          startsOn: '2026-12-24',
          endsOn: '2026-12-24',
          reason,
        });

        expect(db.values).toHaveBeenCalledWith({
          startsOn: '2026-12-24',
          endsOn: '2026-12-24',
          reason: null,
        });
      },
    );

    it('Given une fermeture d’un seul jour, Then elle est acceptée (fin = début)', async () => {
      db.returning.mockResolvedValueOnce([anAvailabilityClosure()]);

      await service.createClosure({
        startsOn: '2027-01-04',
        endsOn: '2027-01-04',
      });

      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['la veille', '2026-12-26', '2026-12-25'],
      ['l’année précédente', '2027-01-02', '2026-12-31'],
    ])(
      'Given une fin %s du début, Then 400 sans insertion',
      async (_case, startsOn, endsOn) => {
        const err = await rejectionOf(
          service.createClosure({ startsOn, endsOn }),
        );

        expect(err).toBeInstanceOf(BadRequestException);
        expect(db.insert).not.toHaveBeenCalled();
      },
    );
  });

  describe('deleteClosure', () => {
    const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    it('Given une fermeture existante, Then elle est supprimée par son id', async () => {
      db.returning.mockResolvedValueOnce([anAvailabilityClosure({ id: ID })]);

      await expect(service.deleteClosure(ID)).resolves.toBeUndefined();
      expect(db.delete).toHaveBeenCalledWith(availabilityClosures);
      const [condition] = db.where.mock.calls[0] as [unknown];
      expect(render(condition).params).toEqual([ID]);
    });

    it('Given une fermeture inconnue, Then 404', async () => {
      db.returning.mockResolvedValueOnce([]);

      await expect(service.deleteClosure(ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

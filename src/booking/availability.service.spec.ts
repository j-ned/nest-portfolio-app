import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
  anAvailabilityOverride,
  anAvailabilityRule,
} from './booking-test-builders';
import type { DayOverrideKind } from './resolve-day';

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

  describe('listOverrides', () => {
    it('Given des exceptions en base, When listOverrides, Then une table date → sorte', async () => {
      db.where.mockResolvedValueOnce([
        anAvailabilityOverride({ day: '2026-11-12', kind: 'closed' }),
        anAvailabilityOverride({ day: '2026-11-11', kind: 'open' }),
      ]);

      await expect(
        service.listOverrides(
          db as unknown as DbExecutor,
          '2026-11-02',
          '2026-11-23',
        ),
      ).resolves.toEqual(
        new Map([
          ['2026-11-12', 'closed'],
          ['2026-11-11', 'open'],
        ]),
      );
    });

    it('Given une fenêtre de dates, Then availability_override est lue entre ses deux bornes', async () => {
      db.where.mockResolvedValueOnce([]);

      await service.listOverrides(
        db as unknown as DbExecutor,
        '2026-11-02',
        '2026-11-23',
      );

      expect(db.from).toHaveBeenCalledTimes(1);
      const [table] = db.from.mock.calls[0] as [Table];
      expect(getTableName(table)).toBe('availability_override');
      const [condition] = db.where.mock.calls[0] as [unknown];
      expect(render(condition).params).toEqual(['2026-11-02', '2026-11-23']);
    });

    it('Given aucune exception dans la fenêtre, Then une table vide', async () => {
      db.where.mockResolvedValueOnce([]);

      const overrides = await service.listOverrides(
        db as unknown as DbExecutor,
        '2026-11-02',
        '2026-11-23',
      );

      expect(overrides.size).toBe(0);
    });

    it('Given un exécuteur de transaction, Then les exceptions sont lues par lui, jamais par la connexion partagée', async () => {
      const tx = createMockDb();
      tx.where.mockResolvedValueOnce([
        anAvailabilityOverride({ day: '2026-11-12', kind: 'closed' }),
      ]);

      await expect(
        service.listOverrides(
          tx as unknown as DbExecutor,
          '2026-11-12',
          '2026-11-12',
        ),
      ).resolves.toEqual(new Map([['2026-11-12', 'closed']]));
      expect(tx.select).toHaveBeenCalledTimes(1);
      expect(db.select).not.toHaveBeenCalled();
    });
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

describe('AvailabilityService.setDayOpen', () => {
  const EVERY_DAY_9_TO_11 = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    anAvailabilityRule({ weekday, startMinute: 540, endMinute: 660 }),
  );
  const ORDINARY = '2026-11-12';
  const ARMISTICE = '2026-11-11';

  let service: AvailabilityService;
  let db: ReturnType<typeof createMockDb>;
  let tx: ReturnType<typeof createMockDb>;
  let reads: {
    listRules: jest.SpyInstance;
    listClosures: jest.SpyInstance;
    readClosePublicHolidays: jest.SpyInstance;
    listOverrides: jest.SpyInstance;
  };

  const givenAfterWrite = (overrides: [string, DayOverrideKind][]) =>
    reads.listOverrides.mockResolvedValue(new Map(overrides));
  const givenClosures = (
    closures: ReturnType<typeof anAvailabilityClosure>[],
  ) => reads.listClosures.mockResolvedValue(closures);
  const lastCall = (mock: jest.Mock | jest.SpyInstance): number =>
    Math.max(...mock.mock.invocationCallOrder);
  const expectNoWrite = () => {
    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  };

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
    reads = {
      listRules: jest
        .spyOn(service, 'listRules')
        .mockResolvedValue(EVERY_DAY_9_TO_11),
      listClosures: jest.spyOn(service, 'listClosures').mockResolvedValue([]),
      readClosePublicHolidays: jest
        .spyOn(service, 'readClosePublicHolidays')
        .mockResolvedValue(true),
      listOverrides: jest
        .spyOn(service, 'listOverrides')
        .mockResolvedValue(new Map()),
    };
    jest.useFakeTimers().setSystemTime(new Date('2026-11-10T09:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('état souhaité', () => {
    it.each([
      ['un jour ordinaire sans exception', ORDINARY, true, false, 'closed'],
      [
        'un férié, interrupteur actif, sans exception',
        ARMISTICE,
        true,
        true,
        'open',
      ],
      [
        'un férié fermé à la main, interrupteur actif',
        ARMISTICE,
        true,
        true,
        'open',
      ],
      [
        'un férié, interrupteur inactif, sans exception',
        ARMISTICE,
        false,
        false,
        'closed',
      ],
    ] as const)(
      'Given %s (%s, interrupteur %s), When open: %s, Then l’exception %s est écrite par insertion ou remplacement',
      async (_case, date, closePublicHolidays, open, kind) => {
        reads.readClosePublicHolidays.mockResolvedValue(closePublicHolidays);
        givenAfterWrite([[date, kind]]);

        await service.setDayOpen(date, open);

        expect(tx.insert).toHaveBeenCalledTimes(1);
        const [table] = tx.insert.mock.calls[0] as [Table];
        expect(getTableName(table)).toBe('availability_override');
        expect(tx.values).toHaveBeenCalledWith({ day: date, kind });
        expect(tx.onConflictDoUpdate).toHaveBeenCalledTimes(1);
        const [conflict] = tx.onConflictDoUpdate.mock.calls[0] as [
          { target: { name: string }; set: Record<string, unknown> },
        ];
        expect(conflict.target.name).toBe('day');
        expect(Object.keys(conflict.set)).toEqual(['kind']);
        expect(tx.delete).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['un jour ordinaire fermé à la main', ORDINARY, true, true],
      ['un jour ordinaire sans exception', ORDINARY, true, true],
      ['un férié rouvert, interrupteur actif', ARMISTICE, true, false],
      [
        'un férié fermé à la main, interrupteur inactif',
        ARMISTICE,
        false,
        true,
      ],
    ] as const)(
      'Given %s (%s, interrupteur %s), When open: %s, Then l’exception est supprimée : le jour revient à la règle',
      async (_case, date, closePublicHolidays, open) => {
        reads.readClosePublicHolidays.mockResolvedValue(closePublicHolidays);

        await service.setDayOpen(date, open);

        expect(tx.delete).toHaveBeenCalledTimes(1);
        const [table] = tx.delete.mock.calls[0] as [Table];
        expect(getTableName(table)).toBe('availability_override');
        const [condition] = tx.where.mock.calls.at(-1) as [unknown];
        expect(render(condition).params).toEqual([date]);
        expect(tx.insert).not.toHaveBeenCalled();
      },
    );

    it('Given une écriture, Then elle passe par une seule transaction, jamais par la connexion partagée', async () => {
      await service.setDayOpen(ORDINARY, false);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.insert).toHaveBeenCalledTimes(1);
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('Given une écriture, Then règles, fermetures et interrupteur sont lus par la transaction', async () => {
      await service.setDayOpen(ORDINARY, false);

      expect(reads.readClosePublicHolidays).toHaveBeenCalledWith(tx);
      expect(reads.listClosures).toHaveBeenCalledWith(tx);
      expect(reads.listRules).toHaveBeenCalledWith(tx);
    });

    it('Given une écriture, Then l’exception du jour est relue par la transaction après l’écriture', async () => {
      await service.setDayOpen(ORDINARY, false);

      expect(reads.listOverrides).toHaveBeenCalledWith(tx, ORDINARY, ORDINARY);
      expect(lastCall(reads.listOverrides)).toBeGreaterThan(
        lastCall(tx.insert),
      );
    });
  });

  describe('réponse', () => {
    it('Given un jour ordinaire fermé, Then le jour relu : fermé, créneaux de la semaine type comptés', async () => {
      givenAfterWrite([[ORDINARY, 'closed']]);

      await expect(service.setDayOpen(ORDINARY, false)).resolves.toEqual({
        date: ORDINARY,
        state: 'closed',
        holiday: null,
        slotCount: 4,
        closure: null,
      });
    });

    it('Given un férié rouvert, Then le jour relu : ouvert, nom du férié gardé', async () => {
      givenAfterWrite([[ARMISTICE, 'open']]);

      await expect(service.setDayOpen(ARMISTICE, true)).resolves.toEqual({
        date: ARMISTICE,
        state: 'open',
        holiday: 'Armistice 1918',
        slotCount: 4,
        closure: null,
      });
    });

    it('Given un férié revenu à la règle, interrupteur actif, Then le jour relu : férié fermé', async () => {
      givenAfterWrite([]);

      await expect(service.setDayOpen(ARMISTICE, false)).resolves.toEqual({
        date: ARMISTICE,
        state: 'holiday',
        holiday: 'Armistice 1918',
        slotCount: 4,
        closure: null,
      });
    });
  });

  describe('refus', () => {
    const businessErrorOf = (err: unknown) =>
      (err as { getResponse(): { error?: unknown } }).getResponse().error;

    it.each([
      ['hier', '2026-11-10T09:00:00Z', '2026-11-09'],
      [
        'la veille en date de Paris, déjà le lendemain à 00:30',
        '2026-10-25T23:30:00Z',
        '2026-10-25',
      ],
    ])(
      'Given %s (maintenant %s, jour %s), Then 422 day_in_past sans écriture',
      async (_case, now, date) => {
        jest.setSystemTime(new Date(now));

        const err = await rejectionOf(service.setDayOpen(date, false));

        expect(err).toBeInstanceOf(UnprocessableEntityException);
        expect(businessErrorOf(err)).toBe('day_in_past');
        expectNoWrite();
      },
    );

    it.each([
      [
        'le lendemain du dernier jour du mois courant + 12',
        '2026-11-10T09:00:00Z',
        '2027-12-01',
      ],
      [
        'le lendemain de la borne, mois courant pris à Paris',
        '2026-10-31T23:30:00Z',
        '2027-12-01',
      ],
      ['un an et demi plus tard', '2026-11-10T09:00:00Z', '2028-05-02'],
    ])(
      'Given %s (maintenant %s, jour %s), Then 422 day_out_of_range sans écriture',
      async (_case, now, date) => {
        jest.setSystemTime(new Date(now));

        const err = await rejectionOf(service.setDayOpen(date, false));

        expect(err).toBeInstanceOf(UnprocessableEntityException);
        expect(businessErrorOf(err)).toBe('day_out_of_range');
        expectNoWrite();
      },
    );

    it.each([
      ['aujourd’hui', '2026-11-10T09:00:00Z', '2026-11-10'],
      [
        'le dernier jour du mois courant + 12',
        '2026-11-10T09:00:00Z',
        '2027-11-30',
      ],
      [
        'le dernier jour autorisé, mois courant pris à Paris',
        '2026-10-31T23:30:00Z',
        '2027-11-30',
      ],
    ])(
      'Given %s (maintenant %s, jour %s), Then l’écriture a lieu',
      async (_case, now, date) => {
        jest.setSystemTime(new Date(now));

        await service.setDayOpen(date, false);

        expect(tx.insert).toHaveBeenCalledTimes(1);
        expect(tx.values).toHaveBeenCalledWith({ day: date, kind: 'closed' });
      },
    );

    it.each([
      ['le premier jour', '2026-11-24'],
      ['le dernier jour', '2026-11-26'],
    ])(
      'Given une fermeture du 2026-11-24 au 2026-11-26, When %s (%s), Then 409 day_in_closure sans écriture',
      async (_case, date) => {
        givenClosures([
          anAvailabilityClosure({
            startsOn: '2026-11-24',
            endsOn: '2026-11-26',
          }),
        ]);

        const err = await rejectionOf(service.setDayOpen(date, false));

        expect(err).toBeInstanceOf(ConflictException);
        expect(businessErrorOf(err)).toBe('day_in_closure');
        expectNoWrite();
      },
    );

    it('Given une fermeture du 2026-11-24 au 2026-11-26, When le lendemain, Then l’écriture a lieu', async () => {
      givenClosures([
        anAvailabilityClosure({ startsOn: '2026-11-24', endsOn: '2026-11-26' }),
      ]);

      await service.setDayOpen('2026-11-27', false);

      expect(tx.values).toHaveBeenCalledWith({
        day: '2026-11-27',
        kind: 'closed',
      });
    });

    it.each([
      ['un jour passé sous fermeture', '2026-11-09', 'day_in_past'],
      ['un jour hors limite sous fermeture', '2027-12-01', 'day_out_of_range'],
    ])(
      'Given %s (%s), Then %s : passé et borne passent avant la fermeture',
      async (_case, date, code) => {
        givenClosures([
          anAvailabilityClosure({
            startsOn: '2026-11-01',
            endsOn: '2027-12-31',
          }),
        ]);

        const err = await rejectionOf(service.setDayOpen(date, true));

        expect(err).toBeInstanceOf(UnprocessableEntityException);
        expect(businessErrorOf(err)).toBe(code);
      },
    );
  });
});

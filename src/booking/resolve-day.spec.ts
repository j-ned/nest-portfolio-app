import {
  anAvailabilityClosure,
  anAvailabilityRule,
} from './booking-test-builders';
import {
  closedReason,
  type DayContext,
  type DayOverrideKind,
  templateSlotsOn,
  toCalendarDay,
} from './resolve-day';

const TODAY = '2026-11-10';
const COVERING_11_09_TO_11_11 = anAvailabilityClosure({
  startsOn: '2026-11-09',
  endsOn: '2026-11-11',
});

const aDayContext = (overrides: Partial<DayContext> = {}): DayContext => ({
  today: TODAY,
  closures: [],
  overrides: new Map(),
  closePublicHolidays: true,
  ...overrides,
});

const isoStrings = (slots: readonly Date[]): string[] =>
  slots.map((slot) => slot.toISOString());

describe('resolve-day', () => {
  describe('closedReason, sans exception par date', () => {
    it.each([
      ['hier, sous fermeture', '2026-11-09', true, true, 'past'],
      ['hier, sans fermeture', '2026-11-09', false, true, 'past'],
      [
        'un férié sous fermeture, interrupteur actif',
        '2026-11-11',
        true,
        true,
        'closed-period',
      ],
      ['un férié, interrupteur actif', '2026-11-11', false, true, 'holiday'],
      ['un férié, interrupteur inactif', '2026-11-11', false, false, null],
      [
        'un jour ordinaire, interrupteur actif',
        '2026-11-12',
        false,
        true,
        null,
      ],
      ['aujourd’hui', '2026-11-10', false, true, null],
      [
        'aujourd’hui, sous fermeture',
        '2026-11-10',
        true,
        true,
        'closed-period',
      ],
    ] as const)(
      'Given aujourd’hui le 2026-11-10 et %s (%s, fermeture %s, interrupteur %s), Then %s',
      (_case, date, closed, closePublicHolidays, expected) => {
        const ctx = aDayContext({
          closures: closed ? [COVERING_11_09_TO_11_11] : [],
          closePublicHolidays,
        });

        expect(closedReason(date, ctx)).toBe(expected);
      },
    );

    it.each([
      ['le premier jour', '2026-11-24', 'closed-period'],
      ['le dernier jour', '2026-11-26', 'closed-period'],
      ['la veille', '2026-11-23', null],
      ['le lendemain', '2026-11-27', null],
    ] as const)(
      'Given une fermeture du 2026-11-24 au 2026-11-26, When %s (%s), Then %s',
      (_case, date, expected) => {
        const ctx = aDayContext({
          closures: [
            anAvailabilityClosure({
              startsOn: '2026-11-24',
              endsOn: '2026-11-26',
            }),
          ],
        });

        expect(closedReason(date, ctx)).toBe(expected);
      },
    );

    it.each([
      ['dimanche de Pâques', '2027-03-28', null],
      ['lundi de Pâques', '2027-03-29', 'holiday'],
      ['lundi de Pentecôte', '2027-05-17', 'holiday'],
      ['jour de l’an', '2027-01-01', 'holiday'],
    ] as const)(
      'Given l’interrupteur actif, When le %s (%s), Then %s',
      (_case, date, expected) => {
        expect(closedReason(date, aDayContext())).toBe(expected);
      },
    );
  });

  describe('closedReason, avec exception par date', () => {
    it.each([
      [
        'hier, sous fermeture, exception fermée',
        '2026-11-09',
        true,
        'closed',
        true,
        'past',
      ],
      [
        'un férié sous fermeture, exception ouverte',
        '2026-11-11',
        true,
        'open',
        true,
        'closed-period',
      ],
      [
        'un férié, exception fermée, interrupteur inactif',
        '2026-11-11',
        false,
        'closed',
        false,
        'closed',
      ],
      [
        'un jour ordinaire, exception fermée',
        '2026-11-12',
        false,
        'closed',
        true,
        'closed',
      ],
      [
        'un férié, exception ouverte, interrupteur actif',
        '2026-11-11',
        false,
        'open',
        true,
        null,
      ],
      [
        'un jour ordinaire, exception ouverte',
        '2026-11-12',
        false,
        'open',
        true,
        null,
      ],
    ] as const)(
      'Given aujourd’hui le 2026-11-10 et %s (%s, fermeture %s, exception %s, interrupteur %s), Then %s',
      (_case, date, closed, kind, closePublicHolidays, expected) => {
        const ctx = aDayContext({
          closures: closed ? [COVERING_11_09_TO_11_11] : [],
          overrides: new Map<string, DayOverrideKind>([[date, kind]]),
          closePublicHolidays,
        });

        expect(closedReason(date, ctx)).toBe(expected);
      },
    );

    it('Given une exception fermée le 2026-11-12, Then elle ne ferme que ce jour-là', () => {
      const ctx = aDayContext({
        overrides: new Map<string, DayOverrideKind>([['2026-11-12', 'closed']]),
      });

      expect(closedReason('2026-11-13', ctx)).toBeNull();
    });
  });

  describe('toCalendarDay', () => {
    const WEEKDAYS_9_TO_11 = [1, 2, 3, 4, 5].map((weekday) =>
      anAvailabilityRule({ weekday, startMinute: 540, endMinute: 660 }),
    );
    const CONGES = anAvailabilityClosure({
      startsOn: '2026-11-24',
      endsOn: '2026-11-26',
      reason: 'Congés',
    });
    const dayOf = (
      date: string,
      ctx: Partial<Omit<DayContext, 'closures'>> = {},
      closures: readonly ReturnType<typeof anAvailabilityClosure>[] = [CONGES],
    ) =>
      toCalendarDay(
        date,
        aDayContext({ ...ctx, closures }),
        WEEKDAYS_9_TO_11,
        closures,
      );
    const overrideOn = (date: string, kind: DayOverrideKind) =>
      new Map<string, DayOverrideKind>([[date, kind]]);

    it.each([
      ['un jour ordinaire', '2026-11-12', {}, 'open', null, 4],
      [
        'un jour ordinaire fermé à la main',
        '2026-11-12',
        { overrides: overrideOn('2026-11-12', 'closed') },
        'closed',
        null,
        4,
      ],
      [
        'un férié, interrupteur actif',
        '2026-11-11',
        {},
        'holiday',
        'Armistice 1918',
        4,
      ],
      [
        'un férié rouvert',
        '2026-11-11',
        { overrides: overrideOn('2026-11-11', 'open') },
        'open',
        'Armistice 1918',
        4,
      ],
      [
        'un férié, interrupteur inactif',
        '2026-11-11',
        { closePublicHolidays: false },
        'open',
        'Armistice 1918',
        4,
      ],
      [
        'un férié fermé à la main, interrupteur inactif',
        '2026-11-11',
        {
          closePublicHolidays: false,
          overrides: overrideOn('2026-11-11', 'closed'),
        },
        'closed',
        'Armistice 1918',
        4,
      ],
      ['hier', '2026-11-09', {}, 'past', null, 4],
      ['aujourd’hui', '2026-11-10', {}, 'open', null, 4],
      ['un samedi sans plage', '2026-11-14', {}, 'empty', null, 0],
    ] as const)(
      'Given %s (%s), Then état, férié et nombre de créneaux de la semaine type',
      (_case, date, ctx, state, holiday, slotCount) => {
        expect(dayOf(date, ctx)).toEqual({
          date,
          state,
          holiday,
          slotCount,
          closure: null,
        });
      },
    );

    it('Given un jour sous la fermeture « Congés », Then closed-period avec la fermeture qui le couvre', () => {
      expect(dayOf('2026-11-25')).toEqual({
        date: '2026-11-25',
        state: 'closed-period',
        holiday: null,
        slotCount: 4,
        closure: {
          startsOn: '2026-11-24',
          endsOn: '2026-11-26',
          reason: 'Congés',
        },
      });
    });

    it('Given deux fermetures qui se recouvrent, Then la fermeture rendue est celle qui commence la première', () => {
      const later = anAvailabilityClosure({
        startsOn: '2026-11-20',
        endsOn: '2026-11-30',
        reason: 'Déplacement',
      });
      const earlier = anAvailabilityClosure({
        startsOn: '2026-11-18',
        endsOn: '2026-11-25',
        reason: null,
      });

      expect(dayOf('2026-11-24', {}, [later, earlier]).closure).toEqual({
        startsOn: '2026-11-18',
        endsOn: '2026-11-25',
        reason: null,
      });
    });

    it('Given hier sous une fermeture, Then past sans fermeture rendue', () => {
      const november = anAvailabilityClosure({
        startsOn: '2026-11-01',
        endsOn: '2026-11-30',
        reason: 'Congés',
      });

      expect(dayOf('2026-11-09', {}, [november])).toEqual({
        date: '2026-11-09',
        state: 'past',
        holiday: null,
        slotCount: 4,
        closure: null,
      });
    });

    it.each([
      ['2026-10-25', 48],
      ['2027-03-28', 46],
    ])(
      'Given une plage dimanche 00:00–24:00, When le %s (changement d’heure), Then %i créneaux comptés',
      (date, slotCount) => {
        const day = toCalendarDay(
          date,
          aDayContext({ today: '2026-10-20' }),
          [anAvailabilityRule({ weekday: 7, startMinute: 0, endMinute: 1440 })],
          [],
        );

        expect(day).toEqual({
          date,
          state: 'open',
          holiday: null,
          slotCount,
          closure: null,
        });
      },
    );
  });

  describe('templateSlotsOn', () => {
    const allDaySunday = [
      anAvailabilityRule({ weekday: 7, startMinute: 0, endMinute: 1440 }),
    ];

    it.each([
      ['heure répétée', '2026-10-25', 48],
      ['heure inexistante, jour de Pâques', '2027-03-28', 46],
      ['dimanche ordinaire', '2026-11-08', 48],
    ] as const)(
      'Given une plage dimanche 00:00–24:00, When %s (%s), Then %i créneaux',
      (_case, date, expected) => {
        expect(templateSlotsOn(date, allDaySunday)).toHaveLength(expected);
      },
    );

    it('Given une plage dimanche 00:00–24:00, When le 2026-10-25, Then l’heure répétée n’ouvre qu’un créneau par heure murale', () => {
      const slots = isoStrings(templateSlotsOn('2026-10-25', allDaySunday));

      expect(slots[0]).toBe('2026-10-24T22:00:00.000Z');
      expect(slots.at(-1)).toBe('2026-10-25T22:30:00.000Z');
      expect(slots.slice(4, 7)).toEqual([
        '2026-10-25T00:00:00.000Z',
        '2026-10-25T00:30:00.000Z',
        '2026-10-25T02:00:00.000Z',
      ]);
    });

    it('Given une plage mardi 09:00–10:00, When un mardi, Then 09:00 et 09:30 de Paris, un départ à 10:00 finirait hors plage', () => {
      const rules = [
        anAvailabilityRule({ weekday: 2, startMinute: 540, endMinute: 600 }),
      ];

      expect(isoStrings(templateSlotsOn('2026-11-03', rules))).toEqual([
        '2026-11-03T08:00:00.000Z',
        '2026-11-03T08:30:00.000Z',
      ]);
    });

    it('Given une plage mardi 09:00–09:50, Then un seul créneau, celui de 09:30 dépasserait la fin', () => {
      const rules = [
        anAvailabilityRule({ weekday: 2, startMinute: 540, endMinute: 590 }),
      ];

      expect(isoStrings(templateSlotsOn('2026-11-03', rules))).toEqual([
        '2026-11-03T08:00:00.000Z',
      ]);
    });

    it('Given deux plages le mercredi et une le lundi, When un mercredi, Then seuls les créneaux des plages du mercredi', () => {
      const rules = [
        anAvailabilityRule({ weekday: 1, startMinute: 480, endMinute: 540 }),
        anAvailabilityRule({ weekday: 3, startMinute: 540, endMinute: 600 }),
        anAvailabilityRule({ weekday: 3, startMinute: 840, endMinute: 900 }),
      ];

      expect(isoStrings(templateSlotsOn('2026-11-04', rules))).toEqual([
        '2026-11-04T08:00:00.000Z',
        '2026-11-04T08:30:00.000Z',
        '2026-11-04T13:00:00.000Z',
        '2026-11-04T13:30:00.000Z',
      ]);
    });

    it('Given un férié lointain, Then la semaine type s’applique sans férié, préavis ni horizon', () => {
      const rules = [
        anAvailabilityRule({ weekday: 3, startMinute: 540, endMinute: 600 }),
      ];

      expect(isoStrings(templateSlotsOn('2026-11-11', rules))).toEqual([
        '2026-11-11T08:00:00.000Z',
        '2026-11-11T08:30:00.000Z',
      ]);
      expect(isoStrings(templateSlotsOn('2030-05-01', rules))).toEqual([
        '2030-05-01T07:00:00.000Z',
        '2030-05-01T07:30:00.000Z',
      ]);
    });

    it('Given une plage du lundi seulement, When un mardi, Then aucun créneau', () => {
      expect(templateSlotsOn('2026-11-03', [anAvailabilityRule()])).toEqual([]);
    });
  });
});

import {
  anAvailabilityClosure,
  anAvailabilityRule,
} from './booking-test-builders';
import { closedReason, type DayContext, templateSlotsOn } from './resolve-day';

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

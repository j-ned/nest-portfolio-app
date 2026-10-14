import {
  aBooking,
  anAvailabilityClosure,
  anAvailabilityRule,
} from './booking-test-builders';
import { computeFreeSlots } from './compute-free-slots';
import type { DayOverrideKind } from './resolve-day';

type Slot = { readonly startsAt: Date; readonly endsAt: Date };

const NOW = new Date('2026-11-02T08:00:00Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const starts = (slots: readonly Slot[]): string[] =>
  slots.map((slot) => slot.startsAt.toISOString());

const startsBetween = (
  slots: readonly Slot[],
  from: string,
  to: string,
): string[] =>
  starts(slots).filter(
    (start) =>
      start >= new Date(from).toISOString() &&
      start < new Date(to).toISOString(),
  );

const WEEKDAYS_9_TO_10 = [1, 2, 3, 4, 5].map((weekday) =>
  anAvailabilityRule({ weekday, startMinute: 540, endMinute: 600 }),
);

describe('computeFreeSlots', () => {
  describe('changements d’heure', () => {
    const allDaySunday = [
      anAvailabilityRule({ weekday: 7, startMinute: 0, endMinute: 1440 }),
    ];

    it('Given une plage dimanche 00:00–24:00, When le 25/10/2026 (heure répétée), Then 48 créneaux, l’heure répétée une seule fois', () => {
      const slots = computeFreeSlots({
        overrides: new Map(),
        closePublicHolidays: false,
        now: new Date('2026-10-20T00:00:00Z'),
        rules: allDaySunday,
        closures: [],
        bookings: [],
      });

      const day = startsBetween(
        slots,
        '2026-10-24T22:00:00Z',
        '2026-10-25T23:00:00Z',
      );

      expect(day).toHaveLength(48);
      expect(day[0]).toBe('2026-10-24T22:00:00.000Z');
      expect(day.at(-1)).toBe('2026-10-25T22:30:00.000Z');
      expect(day.slice(4, 7)).toEqual([
        '2026-10-25T00:00:00.000Z',
        '2026-10-25T00:30:00.000Z',
        '2026-10-25T02:00:00.000Z',
      ]);
      expect(day).not.toContain('2026-10-25T01:00:00.000Z');
      expect(day).not.toContain('2026-10-25T01:30:00.000Z');
    });

    it('Given une plage dimanche 00:00–24:00, When le 28/03/2027 (heure inexistante), Then 46 créneaux sans 02:00 ni 02:30', () => {
      const slots = computeFreeSlots({
        overrides: new Map(),
        closePublicHolidays: false,
        now: new Date('2027-03-23T00:00:00Z'),
        rules: allDaySunday,
        closures: [],
        bookings: [],
      });

      const day = startsBetween(
        slots,
        '2027-03-27T23:00:00Z',
        '2027-03-28T22:00:00Z',
      );

      expect(day).toHaveLength(46);
      expect(day[0]).toBe('2027-03-27T23:00:00.000Z');
      expect(day.at(-1)).toBe('2027-03-28T21:30:00.000Z');
      expect(day.slice(3, 5)).toEqual([
        '2027-03-28T00:30:00.000Z',
        '2027-03-28T01:00:00.000Z',
      ]);
    });

    it('Given les créneaux d’un jour de changement d’heure, Then chacun dure 30 min absolues', () => {
      const slots = computeFreeSlots({
        overrides: new Map(),
        closePublicHolidays: false,
        now: new Date('2026-10-20T00:00:00Z'),
        rules: allDaySunday,
        closures: [],
        bookings: [],
      });

      expect(slots.length).toBeGreaterThan(0);
      expect(
        slots.every(
          (slot) =>
            slot.endsAt.getTime() - slot.startsAt.getTime() === 30 * 60_000,
        ),
      ).toBe(true);
    });
  });

  describe('préavis de 24 h', () => {
    it.each([
      ['24 h pile', '2026-11-02T08:00:00Z', true],
      ['23 h 59', '2026-11-02T08:01:00Z', false],
    ])(
      'Given un créneau mardi 09:00 à %s de maintenant, Then proposé = %s',
      (_case, now, expected) => {
        const slots = computeFreeSlots({
          overrides: new Map(),
          closePublicHolidays: false,
          now: new Date(now),
          rules: [
            anAvailabilityRule({
              weekday: 2,
              startMinute: 540,
              endMinute: 600,
            }),
          ],
          closures: [],
          bookings: [],
        });

        expect(starts(slots).includes('2026-11-03T08:00:00.000Z')).toBe(
          expected,
        );
      },
    );
  });

  describe('horizon de 21 jours', () => {
    it.each([
      ['21 j pile', '2026-11-02T08:00:00Z', '2026-11-23T08:00:00.000Z', true],
      [
        '21 j et 30 min',
        '2026-11-02T08:00:00Z',
        '2026-11-23T08:30:00.000Z',
        false,
      ],
      [
        '21 j pile à 09:30',
        '2026-11-02T08:30:00Z',
        '2026-11-23T08:30:00.000Z',
        true,
      ],
    ])(
      'Given un créneau lundi à %s de maintenant, Then proposé = %s',
      (_case, now, slot, expected) => {
        const slots = computeFreeSlots({
          overrides: new Map(),
          closePublicHolidays: false,
          now: new Date(now),
          rules: [
            anAvailabilityRule({
              weekday: 1,
              startMinute: 540,
              endMinute: 600,
            }),
          ],
          closures: [],
          bookings: [],
        });

        expect(starts(slots).includes(slot)).toBe(expected);
      },
    );

    it('Given des plages tous les jours, Then chaque créneau part entre maintenant + 24 h et maintenant + 21 j', () => {
      const everyDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
        anAvailabilityRule({ weekday, startMinute: 0, endMinute: 1440 }),
      );

      const slots = computeFreeSlots({
        overrides: new Map(),
        closePublicHolidays: false,
        now: NOW,
        rules: everyDay,
        closures: [],
        bookings: [],
      });

      const times = slots.map((slot) => slot.startsAt.getTime());
      expect(Math.min(...times)).toBe(NOW.getTime() + DAY_MS);
      expect(Math.max(...times)).toBe(NOW.getTime() + 21 * DAY_MS);
    });
  });

  describe('battement de 15 min', () => {
    const wednesday9To12 = [
      anAvailabilityRule({ weekday: 3, startMinute: 540, endMinute: 720 }),
    ];
    const wednesday = (slots: readonly Slot[]) =>
      startsBetween(slots, '2026-11-03T23:00:00Z', '2026-11-04T23:00:00Z');

    it.each([
      ['09:00', '2026-11-04T08:00:00.000Z', true],
      ['09:30', '2026-11-04T08:30:00.000Z', false],
      ['10:00', '2026-11-04T09:00:00.000Z', false],
      ['10:30', '2026-11-04T09:30:00.000Z', false],
      ['11:00', '2026-11-04T10:00:00.000Z', true],
    ])(
      'Given un rendez-vous confirmé 10:00–10:30, When on regarde %s, Then libre = %s',
      (_time, slot, expected) => {
        const slots = computeFreeSlots({
          overrides: new Map(),
          closePublicHolidays: false,
          now: NOW,
          rules: wednesday9To12,
          closures: [],
          bookings: [
            aBooking({
              startsAt: new Date('2026-11-04T09:00:00Z'),
              endsAt: new Date('2026-11-04T09:30:00Z'),
            }),
          ],
        });

        expect(wednesday(slots).includes(slot)).toBe(expected);
      },
    );

    it('Given un rendez-vous confirmé 10:00–10:30, Then le mercredi propose exactement 09:00, 11:00 et 11:30', () => {
      const slots = computeFreeSlots({
        overrides: new Map(),
        closePublicHolidays: false,
        now: NOW,
        rules: wednesday9To12,
        closures: [],
        bookings: [
          aBooking({
            startsAt: new Date('2026-11-04T09:00:00Z'),
            endsAt: new Date('2026-11-04T09:30:00Z'),
          }),
        ],
      });

      expect(wednesday(slots)).toEqual([
        '2026-11-04T08:00:00.000Z',
        '2026-11-04T10:00:00.000Z',
        '2026-11-04T10:30:00.000Z',
      ]);
    });

    it('Given un rendez-vous 10:15–10:45, Then 09:30 et 11:00 restent libres car le battement s’arrête pile à leur bord', () => {
      const slots = computeFreeSlots({
        overrides: new Map(),
        closePublicHolidays: false,
        now: NOW,
        rules: wednesday9To12,
        closures: [],
        bookings: [
          aBooking({
            startsAt: new Date('2026-11-04T09:15:00Z'),
            endsAt: new Date('2026-11-04T09:45:00Z'),
          }),
        ],
      });

      expect(wednesday(slots)).toEqual([
        '2026-11-04T08:00:00.000Z',
        '2026-11-04T08:30:00.000Z',
        '2026-11-04T10:00:00.000Z',
        '2026-11-04T10:30:00.000Z',
      ]);
    });

    it('Given un rendez-vous annulé 10:00–10:30, Then il ne bloque aucun créneau', () => {
      const slots = computeFreeSlots({
        overrides: new Map(),
        closePublicHolidays: false,
        now: NOW,
        rules: wednesday9To12,
        closures: [],
        bookings: [
          aBooking({
            startsAt: new Date('2026-11-04T09:00:00Z'),
            endsAt: new Date('2026-11-04T09:30:00Z'),
            status: 'cancelled',
            cancelledAt: new Date('2026-11-01T10:00:00Z'),
            cancelledBy: 'visitor',
          }),
        ],
      });

      expect(wednesday(slots)).toEqual([
        '2026-11-04T08:00:00.000Z',
        '2026-11-04T08:30:00.000Z',
        '2026-11-04T09:00:00.000Z',
        '2026-11-04T09:30:00.000Z',
        '2026-11-04T10:00:00.000Z',
        '2026-11-04T10:30:00.000Z',
      ]);
    });
  });

  describe('fermetures', () => {
    it.each([
      ['la veille', '2026-11-03T08:00:00.000Z', true],
      ['le premier jour', '2026-11-04T08:00:00.000Z', false],
      ['un jour du milieu', '2026-11-05T08:00:00.000Z', false],
      ['le dernier jour', '2026-11-06T08:00:00.000Z', false],
      ['le jour ouvré suivant', '2026-11-09T08:00:00.000Z', true],
    ])(
      'Given une fermeture du 04/11 au 06/11, When on regarde %s, Then proposé = %s',
      (_case, slot, expected) => {
        const slots = computeFreeSlots({
          overrides: new Map(),
          closePublicHolidays: false,
          now: NOW,
          rules: WEEKDAYS_9_TO_10,
          closures: [
            anAvailabilityClosure({
              startsOn: '2026-11-04',
              endsOn: '2026-11-06',
            }),
          ],
          bookings: [],
        });

        expect(starts(slots).includes(slot)).toBe(expected);
      },
    );

    it.each([
      ['jeudi 05/11 fermé', '2026-11-05', []],
      [
        'mercredi 04/11 fermé',
        '2026-11-04',
        ['2026-11-04T23:00:00.000Z', '2026-11-04T23:30:00.000Z'],
      ],
    ])(
      'Given une plage jeudi 00:00–01:00 et %s, Then la fermeture suit la date de Paris, pas la date UTC',
      (_case, closedOn, expected) => {
        const slots = computeFreeSlots({
          overrides: new Map(),
          closePublicHolidays: false,
          now: NOW,
          rules: [
            anAvailabilityRule({ weekday: 4, startMinute: 0, endMinute: 60 }),
          ],
          closures: [
            anAvailabilityClosure({ startsOn: closedOn, endsOn: closedOn }),
          ],
          bookings: [],
        });

        expect(
          startsBetween(slots, '2026-11-04T23:00:00Z', '2026-11-05T23:00:00Z'),
        ).toEqual(expected);
      },
    );
  });

  describe('plages', () => {
    it('Given une plage 09:00–10:00, Then seuls 09:00 et 09:30 partent, un départ à 10:00 finirait hors plage', () => {
      const slots = computeFreeSlots({
        overrides: new Map(),
        closePublicHolidays: false,
        now: NOW,
        rules: [
          anAvailabilityRule({ weekday: 2, startMinute: 540, endMinute: 600 }),
        ],
        closures: [],
        bookings: [],
      });

      expect(
        startsBetween(slots, '2026-11-02T23:00:00Z', '2026-11-03T23:00:00Z'),
      ).toEqual(['2026-11-03T08:00:00.000Z', '2026-11-03T08:30:00.000Z']);
    });

    it('Given des plages en désordre et qui se recouvrent, Then les créneaux sont triés et uniques', () => {
      const slots = computeFreeSlots({
        overrides: new Map(),
        closePublicHolidays: false,
        now: NOW,
        rules: [
          anAvailabilityRule({ weekday: 3, startMinute: 600, endMinute: 720 }),
          anAvailabilityRule({ weekday: 1, startMinute: 540, endMinute: 600 }),
          anAvailabilityRule({ weekday: 3, startMinute: 540, endMinute: 660 }),
        ],
        closures: [],
        bookings: [],
      });

      const all = starts(slots);
      expect(all).toEqual([...new Set(all)].sort());
      expect(
        startsBetween(slots, '2026-11-03T23:00:00Z', '2026-11-04T23:00:00Z'),
      ).toEqual([
        '2026-11-04T08:00:00.000Z',
        '2026-11-04T08:30:00.000Z',
        '2026-11-04T09:00:00.000Z',
        '2026-11-04T09:30:00.000Z',
        '2026-11-04T10:00:00.000Z',
        '2026-11-04T10:30:00.000Z',
      ]);
    });

    it('Given aucune plage, Then aucun créneau', () => {
      expect(
        computeFreeSlots({
          now: NOW,
          rules: [],
          closures: [],
          bookings: [],
          overrides: new Map(),
          closePublicHolidays: false,
        }),
      ).toEqual([]);
    });
  });

  describe('jours fériés', () => {
    const EVERY_DAY_9_TO_10 = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
      anAvailabilityRule({ weekday, startMinute: 540, endMinute: 600 }),
    );
    const armistice = (slots: readonly Slot[]) =>
      startsBetween(slots, '2026-11-10T23:00:00Z', '2026-11-11T23:00:00Z');

    it.each([
      ['actif', true, []],
      [
        'inactif',
        false,
        ['2026-11-11T08:00:00.000Z', '2026-11-11T08:30:00.000Z'],
      ],
    ] as const)(
      'Given des plages tous les jours et l’interrupteur des fériés %s (%s), When le 11 novembre, Then %j',
      (_case, closePublicHolidays, expected) => {
        const slots = computeFreeSlots({
          now: NOW,
          rules: EVERY_DAY_9_TO_10,
          closures: [],
          bookings: [],
          overrides: new Map(),
          closePublicHolidays,
        });

        expect(armistice(slots)).toEqual(expected);
      },
    );

    it('Given l’interrupteur actif, Then seul le férié disparaît, la veille et le lendemain gardent leurs créneaux', () => {
      const slots = computeFreeSlots({
        now: NOW,
        rules: EVERY_DAY_9_TO_10,
        closures: [],
        bookings: [],
        overrides: new Map(),
        closePublicHolidays: true,
      });

      expect(
        startsBetween(slots, '2026-11-09T23:00:00Z', '2026-11-12T23:00:00Z'),
      ).toEqual([
        '2026-11-10T08:00:00.000Z',
        '2026-11-10T08:30:00.000Z',
        '2026-11-12T08:00:00.000Z',
        '2026-11-12T08:30:00.000Z',
      ]);
      expect(slots).toHaveLength(39);
    });

    it.each([
      [
        'mercredi 11/11 23:00–24:00',
        3,
        1380,
        1440,
        '2026-11-11T21:00:00Z',
        '2026-11-11T23:00:00Z',
        [],
      ],
      [
        'jeudi 12/11 00:00–01:00',
        4,
        0,
        60,
        '2026-11-11T23:00:00Z',
        '2026-11-12T01:00:00Z',
        ['2026-11-11T23:00:00.000Z', '2026-11-11T23:30:00.000Z'],
      ],
    ] as const)(
      'Given l’interrupteur actif et une plage %s, Then le férié suit la date de Paris, pas la date UTC',
      (_case, weekday, startMinute, endMinute, from, to, expected) => {
        const slots = computeFreeSlots({
          now: NOW,
          rules: [anAvailabilityRule({ weekday, startMinute, endMinute })],
          closures: [],
          bookings: [],
          overrides: new Map(),
          closePublicHolidays: true,
        });

        expect(startsBetween(slots, from, to)).toEqual(expected);
      },
    );

    it('Given l’interrupteur actif et une plage tous les jours 00:00–24:00, Then le dimanche de Pâques garde ses 46 créneaux, le lundi de Pâques n’en a aucun', () => {
      const allDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
        anAvailabilityRule({ weekday, startMinute: 0, endMinute: 1440 }),
      );

      const slots = computeFreeSlots({
        now: new Date('2027-03-23T00:00:00Z'),
        rules: allDay,
        closures: [],
        bookings: [],
        overrides: new Map(),
        closePublicHolidays: true,
      });

      expect(
        startsBetween(slots, '2027-03-27T23:00:00Z', '2027-03-28T22:00:00Z'),
      ).toHaveLength(46);
      expect(
        startsBetween(slots, '2027-03-28T22:00:00Z', '2027-03-29T22:00:00Z'),
      ).toEqual([]);
      expect(
        startsBetween(slots, '2027-03-29T22:00:00Z', '2027-03-30T22:00:00Z'),
      ).toHaveLength(48);
    });
  });

  describe('exceptions par date', () => {
    const EVERY_DAY_9_TO_10 = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
      anAvailabilityRule({ weekday, startMinute: 540, endMinute: 600 }),
    );
    const between10And13 = (slots: readonly Slot[]) =>
      startsBetween(slots, '2026-11-09T23:00:00Z', '2026-11-12T23:00:00Z');
    const slotsWith = (
      overrides: ReadonlyMap<string, DayOverrideKind>,
      closures: readonly ReturnType<typeof anAvailabilityClosure>[] = [],
    ) =>
      computeFreeSlots({
        now: NOW,
        rules: EVERY_DAY_9_TO_10,
        closures,
        bookings: [],
        overrides,
        closePublicHolidays: true,
      });

    it('Given une exception fermée le 12/11, Then ce jour n’a plus aucun créneau, ses voisins gardent les leurs', () => {
      const slots = slotsWith(new Map([['2026-11-12', 'closed']]));

      expect(between10And13(slots)).toEqual([
        '2026-11-10T08:00:00.000Z',
        '2026-11-10T08:30:00.000Z',
      ]);
      expect(slots).toHaveLength(37);
    });

    it('Given l’interrupteur actif et une exception ouverte le 11/11, Then le férié rouvert propose ses créneaux', () => {
      const slots = slotsWith(new Map([['2026-11-11', 'open']]));

      expect(between10And13(slots)).toEqual([
        '2026-11-10T08:00:00.000Z',
        '2026-11-10T08:30:00.000Z',
        '2026-11-11T08:00:00.000Z',
        '2026-11-11T08:30:00.000Z',
        '2026-11-12T08:00:00.000Z',
        '2026-11-12T08:30:00.000Z',
      ]);
      expect(slots).toHaveLength(41);
    });

    it('Given une exception ouverte le 11/11 sous une fermeture, Then la fermeture l’emporte', () => {
      const slots = slotsWith(new Map([['2026-11-11', 'open']]), [
        anAvailabilityClosure({ startsOn: '2026-11-11', endsOn: '2026-11-11' }),
      ]);

      expect(between10And13(slots)).toEqual([
        '2026-11-10T08:00:00.000Z',
        '2026-11-10T08:30:00.000Z',
        '2026-11-12T08:00:00.000Z',
        '2026-11-12T08:30:00.000Z',
      ]);
    });
  });
});

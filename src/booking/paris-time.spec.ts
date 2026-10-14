import {
  addDays,
  formatParisLong,
  isoWeekday,
  parisWallTimeToUtc,
  toParisDate,
} from './paris-time';

const WALL_TIMES: readonly [string, string, number, string | null][] = [
  ['lundi en heure d’été', '2026-10-19', 540, '2026-10-19T07:00:00.000Z'],
  ['lundi en heure d’hiver', '2026-10-26', 540, '2026-10-26T08:00:00.000Z'],
  [
    'lundi avant le passage à l’été',
    '2027-03-22',
    540,
    '2027-03-22T08:00:00.000Z',
  ],
  [
    'lundi après le passage à l’été',
    '2027-03-29',
    540,
    '2027-03-29T07:00:00.000Z',
  ],
  ['heure répétée, la plus tôt', '2026-10-25', 150, '2026-10-25T00:30:00.000Z'],
  [
    'heure répétée 02:00, la plus tôt',
    '2026-10-25',
    120,
    '2026-10-25T00:00:00.000Z',
  ],
  [
    'première heure après la répétition',
    '2026-10-25',
    180,
    '2026-10-25T02:00:00.000Z',
  ],
  [
    'minuit du jour de la répétition',
    '2026-10-25',
    0,
    '2026-10-24T22:00:00.000Z',
  ],
  [
    '23:30 du jour de la répétition',
    '2026-10-25',
    1410,
    '2026-10-25T22:30:00.000Z',
  ],
  ['heure inexistante 02:30', '2027-03-28', 150, null],
  ['heure inexistante 02:00', '2027-03-28', 120, null],
  [
    'dernière heure avant le trou',
    '2027-03-28',
    90,
    '2027-03-28T00:30:00.000Z',
  ],
  [
    'première heure après le trou',
    '2027-03-28',
    180,
    '2027-03-28T01:00:00.000Z',
  ],
];

const PARIS_DATES: readonly [string, string][] = [
  ['2026-10-24T22:30:00Z', '2026-10-25'],
  ['2026-10-25T22:59:00Z', '2026-10-25'],
  ['2026-10-25T23:00:00Z', '2026-10-26'],
  ['2027-03-27T23:00:00Z', '2027-03-28'],
  ['2027-03-28T21:59:00Z', '2027-03-28'],
  ['2027-03-28T22:00:00Z', '2027-03-29'],
];

describe('paris-time', () => {
  describe('parisWallTimeToUtc', () => {
    it.each(WALL_TIMES)(
      'Given %s (%s, minute %i), When converti, Then %s',
      (_case, date, minuteOfDay, expected) => {
        expect(
          parisWallTimeToUtc(date, minuteOfDay)?.toISOString() ?? null,
        ).toBe(expected);
      },
    );
  });

  describe('toParisDate', () => {
    it.each(PARIS_DATES)(
      'Given l’instant %s, When ramené à Paris, Then la date est %s',
      (instant, expected) => {
        expect(toParisDate(new Date(instant))).toBe(expected);
      },
    );
  });

  describe('addDays', () => {
    it.each([
      ['2026-11-10', 1, '2026-11-11'],
      ['2026-11-30', 1, '2026-12-01'],
      ['2026-12-31', 1, '2027-01-01'],
      ['2028-02-28', 1, '2028-02-29'],
      ['2027-02-28', 1, '2027-03-01'],
      ['2026-10-24', 1, '2026-10-25'],
      ['2026-10-25', 1, '2026-10-26'],
      ['2027-03-28', 1, '2027-03-29'],
      ['2026-04-05', 50, '2026-05-25'],
      ['2026-03-01', -1, '2026-02-28'],
      ['2026-11-12', 0, '2026-11-12'],
    ] as const)(
      'Given la date %s, When on ajoute %i jour(s), Then la date est %s',
      (date, days, expected) => {
        expect(addDays(date, days)).toBe(expected);
      },
    );
  });

  describe('isoWeekday', () => {
    it.each([
      ['2026-10-19', 1],
      ['2026-11-04', 3],
      ['2026-10-24', 6],
      ['2026-10-25', 7],
      ['2027-03-28', 7],
    ] as const)(
      'Given la date %s, Then le jour ISO est %i',
      (date, expected) => {
        expect(isoWeekday(date)).toBe(expected);
      },
    );
  });

  describe('formatParisLong', () => {
    it.each([
      ['2026-10-19T07:00:00Z', 'lundi 19 octobre 2026 à 09:00'],
      ['2026-10-26T08:00:00Z', 'lundi 26 octobre 2026 à 09:00'],
      ['2026-10-25T01:30:00Z', 'dimanche 25 octobre 2026 à 02:30'],
      ['2027-03-28T01:00:00Z', 'dimanche 28 mars 2027 à 03:00'],
    ])(
      'Given l’instant %s, Then le libellé est « %s »',
      (instant, expected) => {
        expect(formatParisLong(new Date(instant))).toBe(expected);
      },
    );
  });
});

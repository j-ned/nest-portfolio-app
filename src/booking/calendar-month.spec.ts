import { addMonths, daysOfMonth, monthOf } from './calendar-month';

const datesOf = (month: string, count: number): string[] =>
  Array.from(
    { length: count },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );

describe('calendar-month', () => {
  describe('monthOf', () => {
    it.each([
      ['2026-11-30', '2026-11'],
      ['2027-01-01', '2027-01'],
      ['2028-02-29', '2028-02'],
    ])('Given la date %s, Then le mois %s', (date, expected) => {
      expect(monthOf(date)).toBe(expected);
    });
  });

  describe('addMonths', () => {
    it.each([
      ['2026-11', 1, '2026-12'],
      ['2026-12', 1, '2027-01'],
      ['2026-01', -1, '2025-12'],
      ['2026-11', -1, '2026-10'],
      ['2026-11', 12, '2027-11'],
      ['2026-11', 25, '2028-12'],
      ['2026-03', -13, '2025-02'],
      ['2026-11', 0, '2026-11'],
    ])('Given %s décalé de %i mois, Then %s', (month, months, expected) => {
      expect(addMonths(month, months)).toBe(expected);
    });
  });

  describe('daysOfMonth', () => {
    it.each([
      ['2026-11', 30, '2026-11-30'],
      ['2026-12', 31, '2026-12-31'],
      ['2027-02', 28, '2027-02-28'],
      ['2028-02', 29, '2028-02-29'],
      ['2100-02', 28, '2100-02-28'],
      ['2000-02', 29, '2000-02-29'],
      ['2026-10', 31, '2026-10-31'],
      ['2027-03', 31, '2027-03-31'],
    ])(
      'Given le mois %s, Then %i jours, du 1er au %s',
      (month, count, last) => {
        const days = daysOfMonth(month);

        expect(days).toHaveLength(count);
        expect(days[0]).toBe(`${month}-01`);
        expect(days.at(-1)).toBe(last);
      },
    );

    it.each([
      ['février non bissextile', '2027-02', 28],
      ['février bissextile', '2028-02', 29],
      ['passage à l’heure d’hiver le 25', '2026-10', 31],
      ['passage à l’heure d’été le 28', '2027-03', 31],
    ])(
      'Given %s (%s), Then chaque date une fois, dans l’ordre',
      (_case, month, count) => {
        expect(daysOfMonth(month)).toEqual(datesOf(month, count));
      },
    );
  });
});

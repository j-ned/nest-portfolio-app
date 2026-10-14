import {
  easterSunday,
  frenchPublicHolidays,
  publicHolidayName,
} from './french-public-holidays';

const FIXED: readonly [string, string][] = [
  ['01-01', 'Jour de l’an'],
  ['05-01', 'Fête du Travail'],
  ['05-08', 'Victoire 1945'],
  ['07-14', 'Fête nationale'],
  ['08-15', 'Assomption'],
  ['11-01', 'Toussaint'],
  ['11-11', 'Armistice 1918'],
  ['12-25', 'Noël'],
];

const MOVABLE: readonly [number, string, string, string][] = [
  [2026, '2026-04-06', '2026-05-14', '2026-05-25'],
  [2027, '2027-03-29', '2027-05-06', '2027-05-17'],
  [2028, '2028-04-17', '2028-05-25', '2028-06-05'],
  [2029, '2029-04-02', '2029-05-10', '2029-05-21'],
  [2030, '2030-04-22', '2030-05-30', '2030-06-10'],
];

describe('french-public-holidays', () => {
  describe('easterSunday', () => {
    it.each([
      [2008, '2008-03-23'],
      [2019, '2019-04-21'],
      [2026, '2026-04-05'],
      [2027, '2027-03-28'],
      [2028, '2028-04-16'],
      [2029, '2029-04-01'],
      [2030, '2030-04-21'],
      [2038, '2038-04-25'],
      [2285, '2285-03-22'],
    ])('Given l’année %i, Then Pâques tombe le %s', (year, expected) => {
      expect(easterSunday(year)).toBe(expected);
    });
  });

  describe('frenchPublicHolidays', () => {
    it('Given 2026, Then les onze fériés de métropole avec leur nom', () => {
      expect(frenchPublicHolidays(2026)).toEqual(
        new Map([
          ['2026-01-01', 'Jour de l’an'],
          ['2026-04-06', 'Lundi de Pâques'],
          ['2026-05-01', 'Fête du Travail'],
          ['2026-05-08', 'Victoire 1945'],
          ['2026-05-14', 'Ascension'],
          ['2026-05-25', 'Lundi de Pentecôte'],
          ['2026-07-14', 'Fête nationale'],
          ['2026-08-15', 'Assomption'],
          ['2026-11-01', 'Toussaint'],
          ['2026-11-11', 'Armistice 1918'],
          ['2026-12-25', 'Noël'],
        ]),
      );
    });

    it.each(MOVABLE)(
      'Given %i, Then exactement 11 fériés : lundi de Pâques le %s, Ascension le %s, lundi de Pentecôte le %s, et les 8 fixes',
      (year, easterMonday, ascension, whitMonday) => {
        const holidays = frenchPublicHolidays(year);

        expect(holidays.size).toBe(11);
        expect(holidays.get(easterMonday)).toBe('Lundi de Pâques');
        expect(holidays.get(ascension)).toBe('Ascension');
        expect(holidays.get(whitMonday)).toBe('Lundi de Pentecôte');
        expect(
          FIXED.map(([monthDay]) => holidays.get(`${year}-${monthDay}`)),
        ).toEqual(FIXED.map(([, name]) => name));
      },
    );

    it('Given 2008 où l’Ascension tombe le 1er mai, Then un seul férié ce jour-là, nommé d’après les deux, le fixe d’abord', () => {
      const holidays = frenchPublicHolidays(2008);

      expect(holidays.size).toBe(10);
      expect(holidays.get('2008-05-01')).toBe('Fête du Travail et Ascension');
    });
  });

  describe('publicHolidayName', () => {
    it.each([
      ['2026-11-11', 'Armistice 1918'],
      ['2027-01-01', 'Jour de l’an'],
      ['2027-05-17', 'Lundi de Pentecôte'],
      ['2030-06-10', 'Lundi de Pentecôte'],
      ['2026-12-25', 'Noël'],
    ])('Given le %s, Then férié « %s »', (date, expected) => {
      expect(publicHolidayName(date)).toBe(expected);
    });

    it.each([
      ['dimanche de Pâques', '2026-04-05'],
      ['dimanche de Pentecôte', '2026-05-24'],
      ['lendemain de Noël', '2026-12-26'],
      ['lendemain de la Toussaint', '2027-11-02'],
      ['veille du jour de l’an', '2026-12-31'],
    ])('Given le %s (%s), Then aucun férié', (_case, date) => {
      expect(publicHolidayName(date)).toBeNull();
    });

    it('Given des années demandées dans le désordre, Then chaque date est jugée sur sa propre année', () => {
      expect(publicHolidayName('2029-04-02')).toBe('Lundi de Pâques');
      expect(publicHolidayName('2026-04-02')).toBeNull();
      expect(publicHolidayName('2026-04-06')).toBe('Lundi de Pâques');
      expect(publicHolidayName('2029-04-06')).toBeNull();
    });
  });
});

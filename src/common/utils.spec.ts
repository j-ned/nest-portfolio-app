import { UnprocessableEntityException, Logger } from '@nestjs/common';
import {
  isUniqueViolation,
  mimeToExt,
  slugify,
  fireAndForget,
  parseDurationMs,
  subDays,
  subMinutes,
  formatDate,
  startOfDay,
  endOfDay,
} from './utils';

describe('slugify', () => {
  it('convertit en kebab-case lowercase', () => {
    expect(slugify('Mon site')).toBe('mon-site');
  });

  it('strippe les accents français', () => {
    expect(slugify('Mon Été 2026')).toBe('mon-ete-2026');
  });

  it('compresse les séparateurs multiples', () => {
    expect(slugify('  hello---world  ')).toBe('hello-world');
  });

  it('retourne chaîne vide si aucun caractère valide', () => {
    expect(slugify('!!@@##')).toBe('');
  });
});

describe('mimeToExt', () => {
  it('mappe les 4 MIME whitelistés', () => {
    expect(mimeToExt('image/webp')).toBe('webp');
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('image/png')).toBe('png');
    expect(mimeToExt('image/avif')).toBe('avif');
  });

  it('rejette un MIME non whitelisté', () => {
    expect(() => mimeToExt('image/gif')).toThrow(UnprocessableEntityException);
  });
});

describe('isUniqueViolation', () => {
  it('détecte un conflit Postgres avec column hint', () => {
    const err = { code: '23505', constraint_name: 'project_slug_unique' };
    expect(isUniqueViolation(err, 'slug')).toBe(true);
  });

  it('rejette si constraint ne contient pas le hint', () => {
    const err = { code: '23505', constraint_name: 'other_constraint' };
    expect(isUniqueViolation(err, 'slug')).toBe(false);
  });

  it('rejette si code Postgres différent', () => {
    expect(isUniqueViolation({ code: '99999' })).toBe(false);
  });

  it('rejette si entrée non-objet', () => {
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('détecte un conflit imbriqué dans DrizzleQueryError.cause (sans hint)', () => {
    // Drizzle wraps the raw PostgresError in a DrizzleQueryError whose
    // `.cause` carries the original error (with code + constraint_name).
    const drizzleErr = new Error('Failed query: ...');
    (drizzleErr as unknown as Record<string, unknown>).cause = {
      code: '23505',
      constraint_name: 'disabled_date_date_unique',
    };
    expect(isUniqueViolation(drizzleErr)).toBe(true);
  });

  it('détecte un conflit imbriqué avec column hint', () => {
    const drizzleErr = new Error('Failed query: ...');
    (drizzleErr as unknown as Record<string, unknown>).cause = {
      code: '23505',
      constraint_name: 'project_slug_unique',
    };
    expect(isUniqueViolation(drizzleErr, 'slug')).toBe(true);
  });

  it('rejette si le hint ne correspond pas dans la cause imbriquée', () => {
    const drizzleErr = new Error('Failed query: ...');
    (drizzleErr as unknown as Record<string, unknown>).cause = {
      code: '23505',
      constraint_name: 'other_unique_constraint',
    };
    expect(isUniqueViolation(drizzleErr, 'slug')).toBe(false);
  });
});

describe('fireAndForget', () => {
  it('logs the error context when the promise rejects', async () => {
    const logger = new Logger('test');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const err = new Error('boom');

    fireAndForget(Promise.reject(err), logger, 'context-X');
    await new Promise((r) => setImmediate(r));

    expect(errorSpy).toHaveBeenCalledWith('context-X', err.stack);
  });

  it('does not log when the promise resolves', async () => {
    const logger = new Logger('test');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    fireAndForget(Promise.resolve(42), logger, 'context-Y');
    await new Promise((r) => setImmediate(r));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('stringifies non-Error rejections', async () => {
    const logger = new Logger('test');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    fireAndForget(Promise.reject('plain-string'), logger, 'context-Z');
    await new Promise((r) => setImmediate(r));

    expect(errorSpy).toHaveBeenCalledWith('context-Z', 'plain-string');
  });
});

describe('parseDurationMs', () => {
  it.each([
    ['500ms', 500],
    ['10s', 10_000],
    ['2m', 120_000],
    ['3h', 10_800_000],
    ['1d', 86_400_000],
  ])('parses "%s" as %d ms', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it('throws on invalid input', () => {
    expect(() => parseDurationMs('abc')).toThrow(/Invalid duration/);
    expect(() => parseDurationMs('10 weeks')).toThrow(/Invalid duration/);
  });

  it('is case-insensitive on the unit', () => {
    expect(parseDurationMs('5S')).toBe(5_000);
  });
});

describe('subDays / subMinutes', () => {
  it('subDays subtracts N days from the given date', () => {
    const ref = new Date('2026-05-06T12:00:00Z');
    expect(subDays(ref, 1).toISOString()).toBe('2026-05-05T12:00:00.000Z');
    expect(subDays(ref, 30).toISOString()).toBe('2026-04-06T12:00:00.000Z');
  });

  it('subMinutes subtracts N minutes from the given date', () => {
    const ref = new Date('2026-05-06T12:00:00Z');
    expect(subMinutes(ref, 5).toISOString()).toBe('2026-05-06T11:55:00.000Z');
    expect(subMinutes(ref, 60).toISOString()).toBe('2026-05-06T11:00:00.000Z');
  });
});

describe('formatDate', () => {
  it('formats a date as YYYY-MM-DD in local timezone', () => {
    const d = new Date(2026, 4, 6); // May 6, 2026 (month is 0-indexed)
    expect(formatDate(d)).toBe('2026-05-06');
  });

  it('pads single-digit month and day', () => {
    const d = new Date(2026, 0, 9); // Jan 9, 2026
    expect(formatDate(d)).toBe('2026-01-09');
  });
});

describe('startOfDay / endOfDay', () => {
  it('startOfDay sets time to 00:00:00.000', () => {
    const d = new Date('2026-05-06T15:30:45.123Z');
    const s = startOfDay(d);
    expect(s.getHours()).toBe(0);
    expect(s.getMinutes()).toBe(0);
    expect(s.getSeconds()).toBe(0);
    expect(s.getMilliseconds()).toBe(0);
  });

  it('endOfDay sets time to 23:59:59.999', () => {
    const d = new Date('2026-05-06T15:30:45.123Z');
    const e = endOfDay(d);
    expect(e.getHours()).toBe(23);
    expect(e.getMinutes()).toBe(59);
    expect(e.getSeconds()).toBe(59);
    expect(e.getMilliseconds()).toBe(999);
  });

  it('does not mutate the input date', () => {
    const d = new Date('2026-05-06T15:30:45.123Z');
    const before = d.toISOString();
    startOfDay(d);
    endOfDay(d);
    expect(d.toISOString()).toBe(before);
  });
});

import { isUniqueViolation, MIME_TO_EXT, slugify } from './projects.utils';

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

describe('MIME_TO_EXT', () => {
  it('mappe les 4 MIME whitelistés', () => {
    expect(MIME_TO_EXT['image/webp']).toBe('webp');
    expect(MIME_TO_EXT['image/jpeg']).toBe('jpg');
    expect(MIME_TO_EXT['image/png']).toBe('png');
    expect(MIME_TO_EXT['image/avif']).toBe('avif');
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

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
});

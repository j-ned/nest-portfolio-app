import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROFILE_LIMITS } from './profile-limits';
import { PROFILE_SEED } from './profile.seed';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../drizzle/0028_profile_sans_freelance.sql'),
  'utf8',
);

/** Les deux textes de la migration, dans l'ordre : le remplaçant, puis celui qu'il remplace. */
const texts = (): string[] =>
  [...MIGRATION.matchAll(/\$text\$([\s\S]*?)\$text\$/g)].map((m) => m[1]);

describe('0028 — texte « Ce qui me motive » sans activité freelance (spec 029)', () => {
  it('Given the migration, When read, Then it only replaces the exact text seeded by 0021', () => {
    expect(texts()[1]).toBe(PROFILE_SEED.motivation.description);
  });

  it('Given the replacement, When read, Then it mentions neither freelance, Malt nor a job search', () => {
    expect(texts()[0]).not.toMatch(
      /freelance|malt|cdi|disponible|vos projets/i,
    );
  });

  it('Given the replacement, When read, Then it fits the admin limit and keeps a literal non-breaking space', () => {
    const replacement = texts()[0];

    expect(replacement.length).toBeLessThanOrEqual(
      PROFILE_LIMITS.motivation.description,
    );
    expect(replacement).toContain(' :');
  });

  it('Given the migration, When read, Then it bumps the version so an open editor gets a 409', () => {
    expect(MIGRATION).toMatch(/"version" = "version" \+ 1/);
    expect(MIGRATION).toMatch(/WHERE "id" = 'main'/);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROFILE_SEED } from './profile.seed';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../drizzle/0021_profile_seed.sql'),
  'utf8',
);

/** Le document versé par la migration : le JSON entre les délimiteurs `$seed$`. */
const migrationJson = (): string | undefined =>
  /\$seed\$([\s\S]*)\$seed\$/.exec(MIGRATION)?.[1];

describe('PROFILE_SEED — contenu initial du parcours (spec 021, A2)', () => {
  it('Given the migration, When its JSON is read, Then it is exactly PROFILE_SEED', () => {
    const json = migrationJson();

    expect(json).toBeDefined();
    expect(JSON.parse(json ?? 'null')).toEqual(PROFILE_SEED);
  });

  it('Given the migration, When read, Then it inserts the single row once at version 1', () => {
    expect(MIGRATION).toMatch(
      /INSERT INTO "profile_content" \("id", "content", "version"\)\s+VALUES \('main', \$seed\$/,
    );
    expect(MIGRATION).toMatch(
      /\$seed\$::jsonb, 1\)\s+ON CONFLICT \("id"\) DO NOTHING;/,
    );
  });

  it('Given the migration, When read, Then non-breaking spaces are literal characters, not escapes', () => {
    const json = migrationJson() ?? '';

    expect(json.split('\u00A0')).toHaveLength(7);
    expect(json).not.toContain('\\u00a0');
  });

  // Formulations validées par le propriétaire (verrouillées côté front par profile.static-data.spec).
  it.each([
    [
      'biography.summary',
      () => PROFILE_SEED.biography.summary,
      "De la chaudronnerie au tournage CN dans l'aéronautique, et au développement web en parallèle\u00A0: la même exigence.",
    ],
    [
      'biography.leadEmphasis',
      () => PROFILE_SEED.biography.leadEmphasis,
      "Angular et NestJS d'abord, PHP et Java aussi, en méthode agile.",
    ],
    [
      'biography.paragraphs[0]',
      () => PROFILE_SEED.biography.paragraphs[0],
      "Je ne suis pas venu au développement web par hasard. De la chaudronnerie au tournage CN de haute précision dans l'aéronautique, mon métier aujourd'hui, j'ai vu les outils numériques transformer un secteur entier. J'ai compris que je pouvais avoir plus d'impact en créant ces outils plutôt qu'en les utilisant.",
    ],
    [
      "highlights « Vision d'ensemble »",
      () =>
        PROFILE_SEED.highlights.find((h) => h.title === "Vision d'ensemble")
          ?.description,
      "Je ne code pas dans le vide. Je comprends le métier, l'architecture, les contraintes.",
    ],
    [
      'workSummary',
      () => PROFILE_SEED.workSummary,
      'Du composant au serveur qui le sert.',
    ],
    [
      'diplomasSummary',
      () => PROFILE_SEED.diplomasSummary,
      'Deux titres professionnels de niveau 5 (Bac+2).',
    ],
  ])('%s is the validated wording', (_field, read, expected) => {
    expect(read()).toBe(expected);
  });

  it('Given the seed, When its lists are read, Then they keep the front order and counts', () => {
    expect(PROFILE_SEED.biography.paragraphs).toHaveLength(3);
    expect(PROFILE_SEED.highlights.map((h) => h.title)).toEqual([
      'Exigence de production',
      'Autonomie réelle',
      "Vision d'ensemble",
    ]);
    expect(PROFILE_SEED.whatIDo.map((w) => w.title)).toEqual([
      'Applications complètes',
      'Infrastructure',
    ]);
    expect(PROFILE_SEED.technologies.map((t) => t.icon)).toEqual([
      'angular',
      'nestjs',
      'typescript',
      'tailwindcss',
      'postgresql',
      'docker',
    ]);
    expect(PROFILE_SEED.diplomas.map((d) => d.provider)).toEqual([
      'Studi',
      'ALT-RH',
    ]);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORKSHOP_GUIDE_SEED } from './workshop-guide.seed';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../drizzle/0030_workshop_guide.sql'),
  'utf8',
);

/** Le document versé par la migration : le JSON entre les délimiteurs `$seed$`. */
const migrationJson = (): string | undefined =>
  /\$seed\$([\s\S]*)\$seed\$/.exec(MIGRATION)?.[1];

describe('0030 — guide des plaquettes (spec 035 du front)', () => {
  it('Given the seed, When read, Then the guide is disabled and empty (no real data)', () => {
    expect(WORKSHOP_GUIDE_SEED).toEqual({ enabled: false, entries: [] });
  });

  it('Given the migration, When read, Then it creates the single-row table', () => {
    expect(MIGRATION).toContain('CREATE TABLE "workshop_guide"');
    expect(MIGRATION).toContain(
      `CONSTRAINT "workshop_guide_single_row" CHECK ("workshop_guide"."id" = 'main')`,
    );
  });

  it('Given the migration, When its JSON is read, Then it is exactly WORKSHOP_GUIDE_SEED', () => {
    const json = migrationJson();

    expect(json).toBeDefined();
    expect(JSON.parse(json ?? 'null')).toEqual(WORKSHOP_GUIDE_SEED);
  });

  it('Given the migration, When read, Then it inserts the single row once at version 1', () => {
    expect(MIGRATION).toMatch(
      /INSERT INTO "workshop_guide" \("id", "content", "version"\)\s+VALUES \('main', \$seed\$/,
    );
    expect(MIGRATION).toMatch(
      /\$seed\$::jsonb, 1\)\s+ON CONFLICT \("id"\) DO NOTHING;/,
    );
  });
});

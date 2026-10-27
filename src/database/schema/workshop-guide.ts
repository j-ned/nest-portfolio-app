import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { WorkshopGuideContent } from '../../workshop-guide/workshop-guide-content';

/** Seule ligne autorisée : le guide des plaquettes est un document unique (spec 035 du front). */
export const WORKSHOP_GUIDE_ROW_ID = 'main';

/**
 * Guide des plaquettes : une ligne, document `jsonb` remplacé d'un bloc sous contrôle de version
 * (`PUT` conditionnel, 409 si la version a changé), comme le parcours (`profile_content`).
 */
export const workshopGuide = pgTable(
  'workshop_guide',
  {
    id: text('id').primaryKey().default(WORKSHOP_GUIDE_ROW_ID),
    content: jsonb('content').$type<WorkshopGuideContent>().notNull(),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    singleRow: check('workshop_guide_single_row', sql`${t.id} = 'main'`),
  }),
);

export type WorkshopGuideRow = typeof workshopGuide.$inferSelect;

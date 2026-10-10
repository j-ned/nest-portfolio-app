import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { ProfileContent } from '../../profile/profile-content';

/** Seule ligne autorisée : le parcours est un document unique (ADR-0023 §1). */
export const PROFILE_ROW_ID = 'main';

/**
 * Contenu de la page Parcours : une ligne, document `jsonb` remplacé d'un bloc sous contrôle de
 * version (`PUT` conditionnel, 409 si la version a changé). Le portrait est hors version : le
 * remplacer n'invalide pas un brouillon de texte ouvert. `previous_portrait_key` garde la clé qu'une
 * page déjà servie peut encore citer ; elle est effacée au changement suivant.
 */
export const profileContent = pgTable(
  'profile_content',
  {
    id: text('id').primaryKey().default(PROFILE_ROW_ID),
    content: jsonb('content').$type<ProfileContent>().notNull(),
    version: integer('version').notNull().default(1),
    portraitKey: text('portrait_key'),
    previousPortraitKey: text('previous_portrait_key'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    singleRow: check('profile_content_single_row', sql`${t.id} = 'main'`),
  }),
);

export type ProfileContentRow = typeof profileContent.$inferSelect;

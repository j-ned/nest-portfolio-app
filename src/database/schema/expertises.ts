import { pgTable, uuid, text, index, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const expertiseTypeEnum = pgEnum('expertise_type', ['offer', 'seek']);

export const expertises = pgTable(
  'expertise',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    type: expertiseTypeEnum('type').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    ...timestamps(),
  },
  (t) => ({
    typeIdx: index('expertise_type_idx').on(t.type),
  }),
);

export type Expertise = typeof expertises.$inferSelect;
export type NewExpertise = typeof expertises.$inferInsert;
export type ExpertiseType = (typeof expertiseTypeEnum.enumValues)[number];

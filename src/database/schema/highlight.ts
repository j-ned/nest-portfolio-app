import { pgTable, uuid, text, integer, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const HIGHLIGHT_SECTIONS = ['profile', 'home'] as const;
export type HighlightSection = (typeof HIGHLIGHT_SECTIONS)[number];

export const highlight = pgTable(
  'highlight',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    title: text('title').notNull(),
    description: text('description').notNull(),
    icon: text('icon').notNull(),
    section: text('section')
      .$type<HighlightSection>()
      .notNull()
      .default('profile'),
    order: integer('order').notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    index('idx_highlight_section').on(table.section),
    index('idx_highlight_order').on(table.order),
  ],
);

export type Highlight = typeof highlight.$inferSelect;
export type NewHighlight = typeof highlight.$inferInsert;

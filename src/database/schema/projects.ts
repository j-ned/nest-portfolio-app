import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export type TechChoice = { techno: string; why: string };
export type ArchitectureDecision = { decision: string; rationale: string };

export const projects = pgTable(
  'project',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    category: text('category').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    description: text('description').notNull(),
    image: text('image').notNull().default(''),
    techChoices: jsonb('tech_choices')
      .$type<TechChoice[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    architectureDecisions: jsonb('architecture_decisions')
      .$type<ArchitectureDecision[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    liveUrl: text('live_url'),
    repoUrl: text('repo_url'),
    repoUrlFront: text('repo_url_front'),
    repoUrlBack: text('repo_url_back'),
    featured: boolean('featured').notNull().default(false),
    order: integer('order').notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    categoryIdx: index('project_category_idx').on(t.category),
    featuredIdx: index('project_featured_idx').on(t.featured),
    orderIdx: index('project_order_idx').on(t.order),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

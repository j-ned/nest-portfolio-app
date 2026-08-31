import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const blogPosts = pgTable(
  'blog_post',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    excerpt: text('excerpt').notNull(),
    contentMarkdown: text('content_markdown').notNull(),
    coverImage: text('cover_image').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
    likesCount: integer('likes_count').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    statusIdx: index('blog_post_status_idx').on(t.status),
    publishedAtIdx: index('blog_post_published_at_idx').on(t.publishedAt),
  }),
);

export type BlogPost = typeof blogPosts.$inferSelect;
export type NewBlogPost = typeof blogPosts.$inferInsert;

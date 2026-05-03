ALTER TABLE "profile" ADD COLUMN "bio_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "bio_paragraphs" text[] DEFAULT '{}'::text[] NOT NULL;
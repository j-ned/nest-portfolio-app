DROP TABLE IF EXISTS "hero" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "social_link" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "diploma" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "technology" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "expertise" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "service_pricing" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "booking" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "disabled_date" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "highlight" CASCADE;--> statement-breakpoint
ALTER TABLE IF EXISTS "profile" DROP COLUMN IF EXISTS "bio_title";--> statement-breakpoint
ALTER TABLE IF EXISTS "profile" DROP COLUMN IF EXISTS "bio_paragraphs";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."expertise_type";

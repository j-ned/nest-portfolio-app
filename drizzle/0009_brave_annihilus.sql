DROP TABLE "hero" CASCADE;--> statement-breakpoint
DROP TABLE "social_link" CASCADE;--> statement-breakpoint
DROP TABLE "diploma" CASCADE;--> statement-breakpoint
DROP TABLE "technology" CASCADE;--> statement-breakpoint
DROP TABLE "expertise" CASCADE;--> statement-breakpoint
DROP TABLE "service_pricing" CASCADE;--> statement-breakpoint
DROP TABLE "booking" CASCADE;--> statement-breakpoint
DROP TABLE "disabled_date" CASCADE;--> statement-breakpoint
DROP TABLE "highlight" CASCADE;--> statement-breakpoint
ALTER TABLE "profile" DROP COLUMN "bio_title";--> statement-breakpoint
ALTER TABLE "profile" DROP COLUMN "bio_paragraphs";--> statement-breakpoint
DROP TYPE "public"."expertise_type";
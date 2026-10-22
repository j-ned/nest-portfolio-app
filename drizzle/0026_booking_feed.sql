ALTER TABLE "booking_setting" ADD COLUMN "feed_salt" text;--> statement-breakpoint
ALTER TABLE "booking_setting" ADD COLUMN "feed_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_setting" ADD CONSTRAINT "booking_setting_feed_check" CHECK (("booking_setting"."feed_salt" is null) = ("booking_setting"."feed_created_at" is null));
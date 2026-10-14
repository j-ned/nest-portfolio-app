CREATE TABLE "booking_setting" (
	"id" text PRIMARY KEY DEFAULT 'main' NOT NULL,
	"close_public_holidays" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_setting_single_row" CHECK ("booking_setting"."id" = 'main')
);

CREATE TABLE "profile_content" (
	"id" text PRIMARY KEY DEFAULT 'main' NOT NULL,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"portrait_key" text,
	"previous_portrait_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_content_single_row" CHECK ("profile_content"."id" = 'main')
);

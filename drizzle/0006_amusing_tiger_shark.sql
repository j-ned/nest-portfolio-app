CREATE TABLE "analytics_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_hash" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_id" text,
	"entity_title" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_stat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"bounces" integer DEFAULT 0 NOT NULL,
	"total_duration" integer DEFAULT 0 NOT NULL,
	"project_clicks" integer DEFAULT 0 NOT NULL,
	"article_views" integer DEFAULT 0 NOT NULL,
	"cv_downloads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_stat_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "page_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_hash" text NOT NULL,
	"url" text NOT NULL,
	"referrer" text,
	"browser" text,
	"os" text,
	"country" text,
	"duration" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analytics_event_session_hash_idx" ON "analytics_event" USING btree ("session_hash");--> statement-breakpoint
CREATE INDEX "analytics_event_type_created_idx" ON "analytics_event" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "analytics_event_entity_idx" ON "analytics_event" USING btree ("event_type","entity_id");--> statement-breakpoint
CREATE INDEX "daily_stat_date_idx" ON "daily_stat" USING btree ("date");--> statement-breakpoint
CREATE INDEX "page_view_session_hash_idx" ON "page_view" USING btree ("session_hash");--> statement-breakpoint
CREATE INDEX "page_view_created_at_idx" ON "page_view" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "page_view_url_idx" ON "page_view" USING btree ("url");
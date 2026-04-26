CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"description" text NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"live_url" text,
	"repo_url" text,
	"repo_url_front" text,
	"repo_url_back" text,
	"featured" boolean DEFAULT false NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "project_category_idx" ON "project" USING btree ("category");--> statement-breakpoint
CREATE INDEX "project_featured_idx" ON "project" USING btree ("featured");--> statement-breakpoint
CREATE INDEX "project_order_idx" ON "project" USING btree ("order");
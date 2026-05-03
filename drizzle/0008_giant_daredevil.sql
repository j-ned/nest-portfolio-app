CREATE TABLE "highlight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"section" text DEFAULT 'profile' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_highlight_section" ON "highlight" USING btree ("section");--> statement-breakpoint
CREATE INDEX "idx_highlight_order" ON "highlight" USING btree ("order");
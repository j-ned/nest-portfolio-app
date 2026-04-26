CREATE TABLE "contact_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contact_message_read_idx" ON "contact_message" USING btree ("read");--> statement-breakpoint
CREATE INDEX "contact_message_created_at_idx" ON "contact_message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contact_message_read_created_idx" ON "contact_message" USING btree ("read","created_at");
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"duration" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disabled_date" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	CONSTRAINT "disabled_date_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE INDEX "booking_date_idx" ON "booking" USING btree ("date");--> statement-breakpoint
CREATE INDEX "booking_created_at_idx" ON "booking" USING btree ("created_at");
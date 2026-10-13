CREATE TABLE "availability_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_closure_range_check" CHECK ("availability_closure"."ends_on" >= "availability_closure"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "availability_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rule_weekday_check" CHECK ("availability_rule"."weekday" between 1 and 7),
	CONSTRAINT "availability_rule_range_check" CHECK ("availability_rule"."start_minute" >= 0 and "availability_rule"."end_minute" <= 1440 and "availability_rule"."end_minute" > "availability_rule"."start_minute")
);
--> statement-breakpoint
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"message" text NOT NULL,
	"format" text NOT NULL,
	"video_url" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"cancel_token_hash" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_cancel_token_hash_unique" UNIQUE("cancel_token_hash"),
	CONSTRAINT "booking_range_check" CHECK ("booking"."ends_at" > "booking"."starts_at"),
	CONSTRAINT "booking_format_check" CHECK ("booking"."format" in ('video', 'phone')),
	CONSTRAINT "booking_status_check" CHECK ("booking"."status" in ('confirmed', 'cancelled')),
	CONSTRAINT "booking_video_check" CHECK (("booking"."format" = 'video') = ("booking"."video_url" is not null)),
	CONSTRAINT "booking_phone_check" CHECK ("booking"."format" <> 'phone' or "booking"."phone" is not null),
	CONSTRAINT "booking_cancel_check" CHECK (("booking"."status" = 'cancelled') = ("booking"."cancelled_at" is not null) and ("booking"."cancelled_by" is null or "booking"."cancelled_by" in ('visitor', 'owner')))
);
--> statement-breakpoint
CREATE INDEX "booking_starts_at_idx" ON "booking" USING btree ("starts_at");
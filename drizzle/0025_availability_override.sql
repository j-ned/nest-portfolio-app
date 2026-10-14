CREATE TABLE "availability_override" (
	"day" date PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_override_kind_check" CHECK ("availability_override"."kind" in ('open', 'closed'))
);

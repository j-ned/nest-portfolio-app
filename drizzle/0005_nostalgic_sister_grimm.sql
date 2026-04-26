CREATE TABLE "cv_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"file_key" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text DEFAULT 'application/pdf' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_file_file_key_unique" UNIQUE("file_key")
);
--> statement-breakpoint
CREATE INDEX "cv_file_uploaded_at_idx" ON "cv_file" USING btree ("uploaded_at");
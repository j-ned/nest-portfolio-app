CREATE TABLE "workshop_guide" (
	"id" text PRIMARY KEY DEFAULT 'main' NOT NULL,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workshop_guide_single_row" CHECK ("workshop_guide"."id" = 'main')
);
--> statement-breakpoint
-- Guide des plaquettes initial (spec 035 du front) : désactivé, aucune ligne (même JSON que
-- src/workshop-guide/workshop-guide.seed.ts, vérifié par workshop-guide-seed.spec.ts). Le contenu se
-- saisit dans l'admin. Rejouée sur une base déjà remplie : sans effet.
INSERT INTO "workshop_guide" ("id", "content", "version")
VALUES ('main', $seed${
  "enabled": false,
  "entries": []
}$seed$::jsonb, 1)
ON CONFLICT ("id") DO NOTHING;

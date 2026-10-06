-- Backfill de la nature des projets existants (ADR-0008 §3), par slug vérifié en prod le 2026-10-06.
-- Les autres projets (coaching-life, le-vieux-comptoir) gardent le défaut 'demo'. Un slug absent (base locale) ne fait rien.
UPDATE "project" SET "kind" = 'production' WHERE "slug" IN ('dashflow', 'candidash');--> statement-breakpoint
UPDATE "project" SET "kind" = 'script' WHERE "slug" IN ('labelsync-pro', 'gitpush-auto');

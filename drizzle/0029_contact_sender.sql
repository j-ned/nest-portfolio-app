-- Formulaire de contact : empreinte HMAC de l'IP et user-agent de l'expéditeur, pour relier et
-- écarter un envoi abusif sans conserver l'IP. Nullable : les messages antérieurs n'en ont pas.
ALTER TABLE "contact_message" ADD COLUMN "sender_hash" text;--> statement-breakpoint
ALTER TABLE "contact_message" ADD COLUMN "user_agent" text;
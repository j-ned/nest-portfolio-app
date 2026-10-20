-- Retrait de la prise de rendez-vous (spec 029 du front, PR 4) : aucun client, aucun rendez-vous réel.
-- Le front ne lit plus /api/booking/* depuis e3a71e0 (déployé avant cette migration). Les migrations
-- 0022 à 0026 qui ont créé ces tables restent intactes : l'historique d'une base n'est jamais réécrit.
DROP TABLE "availability_closure" CASCADE;--> statement-breakpoint
DROP TABLE "availability_override" CASCADE;--> statement-breakpoint
DROP TABLE "availability_rule" CASCADE;--> statement-breakpoint
DROP TABLE "booking_setting" CASCADE;--> statement-breakpoint
DROP TABLE "booking" CASCADE;
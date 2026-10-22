-- Deux rendez-vous confirmés ne se chevauchent jamais ; un rendez-vous annulé libère son créneau.
-- Plage semi-ouverte `[)` : 10:00-10:30 et 10:30-11:00 sont adjacents, pas en conflit. Aucune
-- extension : `btree_gist` n'est requise que pour mêler une égalité scalaire au chevauchement.
ALTER TABLE "booking" ADD CONSTRAINT "booking_no_overlap"
  EXCLUDE USING gist (tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" = 'confirmed');

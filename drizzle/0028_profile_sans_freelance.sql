-- Spec 029 du front : fin de l'activité freelance. Le texte « Ce qui me motive » versé par 0021
-- annonçait une disponibilité freelance (Malt) et une ouverture au CDI, devenues fausses.
-- Ne remplace que ce texte d'origine, mot pour mot : une version déjà corrigée dans l'admin reste
-- intacte. La version monte d'un cran pour qu'un éditeur ouvert sur l'ancienne reçoive un 409
-- au lieu d'écraser la correction. Rejouée : sans effet (le texte d'origine n'y est plus).
UPDATE "profile_content"
SET "content" = jsonb_set("content", '{motivation,description}', to_jsonb($text$Tourneur CN le jour, développeur web le reste du temps : je construis, j'auto-héberge et je partage sur le blog ce que j'apprends.$text$::text)),
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "id" = 'main'
  AND "content" #>> '{motivation,description}' = $text$Disponible en freelance sur Malt pour vos projets Angular et NestJS, et ouvert au CDI en Île-de-France dans une équipe produit fintech, greentech ou industrial tech.$text$;

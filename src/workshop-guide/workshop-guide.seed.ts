import type { StoredWorkshopGuideContent } from './workshop-guide-content';

/**
 * Contenu initial du guide des plaquettes, versé par `drizzle/0030_workshop_guide.sql` (test
 * d'égalité) et renvoyé tant qu'aucun document n'existe : guide désactivé, aucune ligne. Jamais de
 * donnée réelle ici, le contenu se saisit dans l'admin. Sans `decoderEnabled` : la migration 0030
 * est déjà appliquée en prod, le défaut `false` est posé à la lecture (spec 036).
 */
export const WORKSHOP_GUIDE_SEED: StoredWorkshopGuideContent = {
  enabled: false,
  entries: [],
};

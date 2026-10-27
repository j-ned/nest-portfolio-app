import type { WorkshopGuideContent } from './workshop-guide-content';

/**
 * Contenu initial du guide des plaquettes, versé par `drizzle/0030_workshop_guide.sql` (test
 * d'égalité) et renvoyé tant qu'aucun document n'existe : guide désactivé, aucune ligne. Jamais de
 * donnée réelle ici, le contenu se saisit dans l'admin.
 */
export const WORKSHOP_GUIDE_SEED: WorkshopGuideContent = {
  enabled: false,
  entries: [],
};

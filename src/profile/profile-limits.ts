/**
 * Bornes du contenu du parcours (spec 021, D11), calibrées sur le contenu du 2026-10-10 (≤ ×4).
 * Recopiées côté front (`features/profile/domain/models/profile-limits.ts`) pour les messages de
 * formulaire. Toute liste compte au moins un élément : une section ne disparaît pas de la page.
 */
export const PROFILE_LIMITS = {
  biography: {
    title: 80,
    summary: 200,
    leadEmphasis: 160,
    paragraph: 1200,
    paragraphs: 8,
  },
  sectionSummary: 200,
  highlight: { title: 60, description: 400, items: 6 },
  whatIDo: { title: 60, description: 600, items: 6 },
  technology: { name: 40, category: 40, items: 18 },
  diploma: {
    title: 120,
    provider: 80,
    level: 80,
    shortDescription: 600,
    skill: 80,
    skills: 12,
    items: 8,
  },
  motivation: { title: 60, statement: 240, description: 600 },
} as const;

/** Nom de fichier d'une icône de `public/icons/` côté front (la liste fermée vit dans le front). */
export const PROFILE_TECHNOLOGY_ICON_PATTERN = /^[a-z0-9-]{1,40}$/;

/** Bornes des champs éditoriaux d'un projet (ADR-0010 §2), reprises par le formulaire admin. */
export const PROJECT_PITCH_MAX = 160;
export const PROJECT_FACT_MAX = 80;

/**
 * Normalisation au bord de l'API (ADR-0010 §3) : une chaîne est coupée aux extrémités, et vide
 * elle devient `null` (effacement). Tout autre type est rendu tel quel pour que `@IsString` le
 * rejette.
 */
export function toNullableText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim() || null;
}

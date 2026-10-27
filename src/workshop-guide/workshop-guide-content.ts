/**
 * Opérations de tournage du guide des plaquettes (spec 035 du front) : liste fermée, dans l'ordre
 * d'affichage. Recopiée côté front pour les libellés.
 */
export const WORKSHOP_GUIDE_OPERATIONS = [
  'external-roughing',
  'external-finishing',
  'internal-roughing',
  'internal-finishing',
  'drilling',
  'grooving',
  'parting-off',
  'threading',
] as const;

export type WorkshopGuideOperation = (typeof WORKSHOP_GUIDE_OPERATIONS)[number];

/** Une ligne du guide : ce que Julien monte à l'atelier pour une matière et une opération. */
export type WorkshopGuideEntry = {
  readonly material: string;
  readonly operation: WorkshopGuideOperation;
  readonly insert: string;
  /** Rayon de bec, en mm. */
  readonly noseRadius: number;
  /** Absente quand la remarque n'est pas renseignée (jamais de chaîne vide). */
  readonly note?: string;
};

/** Contenu éditable du guide des plaquettes : un document unique, saisi dans l'admin. */
export type WorkshopGuideContent = {
  readonly enabled: boolean;
  readonly entries: readonly WorkshopGuideEntry[];
};

/**
 * Réponse de `GET /api/workshop-guide` : le contenu à plat et sa version. Sans document en base,
 * version 0 et `updatedAt` à `null` (document par défaut, guide désactivé).
 */
export type WorkshopGuideDocument = WorkshopGuideContent & {
  readonly version: number;
  readonly updatedAt: Date | null;
};

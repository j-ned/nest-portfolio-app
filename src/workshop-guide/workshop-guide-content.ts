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
  /** Guide des plaquettes visible sur le site. */
  readonly enabled: boolean;
  /** Décodeur de code ISO visible sur le site (spec 036), indépendant du guide. */
  readonly decoderEnabled: boolean;
  readonly entries: readonly WorkshopGuideEntry[];
};

/**
 * Contenu tel que le `jsonb` le garde : une ligne écrite avant la spec 036 n'a pas
 * `decoderEnabled`, qui vaut alors `false` à la lecture (`toWorkshopGuideContentRead`).
 */
export type StoredWorkshopGuideContent = Omit<
  WorkshopGuideContent,
  'decoderEnabled'
> & {
  readonly decoderEnabled?: boolean;
};

/**
 * Réponse de `GET /api/workshop-guide` : le contenu à plat et sa version. Sans document en base,
 * version 0 et `updatedAt` à `null` (document par défaut, guide désactivé).
 */
export type WorkshopGuideDocument = WorkshopGuideContent & {
  readonly version: number;
  readonly updatedAt: Date | null;
};

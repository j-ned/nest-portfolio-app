/**
 * Opérations de tournage du guide des plaquettes (spec 035 du front) : liste fermée, dans l'ordre
 * d'affichage. Recopiée côté front pour les libellés.
 */
export const WORKSHOP_GUIDE_OPERATIONS = [
  'external-roughing',
  'external-finishing',
  'internal-roughing',
  'internal-finishing',
  'boring',
  'drilling',
  'grooving',
  'parting-off',
  'threading',
] as const;

export type WorkshopGuideOperation = (typeof WORKSHOP_GUIDE_OPERATIONS)[number];

/** Champs communs à toutes les lignes du guide. */
type WorkshopGuideEntryBase = {
  readonly operation: WorkshopGuideOperation;
  readonly insert: string;
  /** Rayon de bec, en mm. Absent quand il n'est pas renseigné (jamais `null`, spec 037). */
  readonly noseRadius?: number;
  /** Absente quand la remarque n'est pas renseignée (jamais de chaîne vide). */
  readonly note?: string;
};

/** Ligne propre à une matière : ce que Julien monte à l'atelier pour cette matière et cette opération. */
export type WorkshopGuideMaterialEntry = WorkshopGuideEntryBase & {
  readonly material: string;
  readonly allMaterials?: never;
};

/** Ligne « toutes matières » (spec 037) : vaut pour chaque matière, sans `material` stocké. */
export type WorkshopGuideAllMaterialsEntry = WorkshopGuideEntryBase & {
  readonly allMaterials: true;
  readonly material?: never;
};

/** Une ligne du guide : propre à une matière, ou commune à toutes. */
export type WorkshopGuideEntry =
  WorkshopGuideMaterialEntry | WorkshopGuideAllMaterialsEntry;

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

import type {
  StoredWorkshopGuideContent,
  WorkshopGuideAllMaterialsEntry,
  WorkshopGuideContent,
  WorkshopGuideMaterialEntry,
} from './workshop-guide-content';

/** Ligne de test neutre, valide au regard du DTO. */
export const anEntry = (
  overrides: Partial<WorkshopGuideMaterialEntry> = {},
): WorkshopGuideMaterialEntry => ({
  material: 'Matière A',
  operation: 'external-roughing',
  insert: 'CODE 0001',
  noseRadius: 0.8,
  note: 'Remarque',
  ...overrides,
});

/** Ligne « toutes matières » de test (spec 037), neutre, sans rayon. */
export const anAllMaterialsEntry = (
  overrides: Partial<WorkshopGuideAllMaterialsEntry> = {},
): WorkshopGuideAllMaterialsEntry => ({
  allMaterials: true,
  operation: 'internal-finishing',
  insert: 'CODE 0003',
  ...overrides,
});

/** Guide de test neutre : jamais le contenu réel saisi dans l'admin. */
export const aWorkshopGuideContent = (
  overrides: Partial<WorkshopGuideContent> = {},
): WorkshopGuideContent => ({
  enabled: true,
  decoderEnabled: true,
  entries: [
    anEntry(),
    anEntry({ operation: 'threading', insert: 'CODE 0002', noseRadius: 0.4 }),
  ],
  ...overrides,
});

/** Le même contenu sans `decoderEnabled` : ligne stockée avant la spec 036, ou corps de l'admin d'avant. */
export const withoutDecoderToggle = ({
  enabled,
  entries,
}: WorkshopGuideContent): StoredWorkshopGuideContent => ({ enabled, entries });

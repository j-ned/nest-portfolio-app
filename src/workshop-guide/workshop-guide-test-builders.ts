import type {
  StoredWorkshopGuideContent,
  WorkshopGuideContent,
  WorkshopGuideEntry,
} from './workshop-guide-content';

/** Ligne de test neutre, valide au regard du DTO. */
export const anEntry = (
  overrides: Partial<WorkshopGuideEntry> = {},
): WorkshopGuideEntry => ({
  material: 'Matière A',
  operation: 'external-roughing',
  insert: 'CODE 0001',
  noseRadius: 0.8,
  note: 'Remarque',
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

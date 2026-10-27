import type {
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
  entries: [
    anEntry(),
    anEntry({ operation: 'threading', insert: 'CODE 0002', noseRadius: 0.4 }),
  ],
  ...overrides,
});

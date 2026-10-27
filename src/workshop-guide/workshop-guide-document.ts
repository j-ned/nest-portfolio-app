import type { WorkshopGuideRow } from '../database/schema/workshop-guide';
import type { UpdateWorkshopGuideDto } from './dto/update-workshop-guide.dto';
import type {
  WorkshopGuideContent,
  WorkshopGuideDocument,
} from './workshop-guide-content';
import { WORKSHOP_GUIDE_SEED } from './workshop-guide.seed';

/** Sans document en base : le guide par défaut, désactivé et vide, à la version 0. */
export const DEFAULT_WORKSHOP_GUIDE_DOCUMENT: WorkshopGuideDocument = {
  ...WORKSHOP_GUIDE_SEED,
  version: 0,
  updatedAt: null,
};

/** Ligne ⇒ réponse publique : contenu à plat, version, date. */
export function toWorkshopGuideDocument(
  row: WorkshopGuideRow,
): WorkshopGuideDocument {
  return { ...row.content, version: row.version, updatedAt: row.updatedAt };
}

/**
 * Corps validé ⇒ contenu stocké : objets simples recopiés champ par champ (ni `version`, ni
 * instance de DTO dans le `jsonb`), textes rognés, remarque vide omise. Les lignes gardent l'ordre
 * reçu ; le tri d'affichage est celui du front.
 */
export function toWorkshopGuideContent(
  dto: UpdateWorkshopGuideDto,
): WorkshopGuideContent {
  return {
    enabled: dto.enabled,
    entries: dto.entries.map(
      ({ material, operation, insert, noseRadius, note }) => {
        const trimmedNote = note?.trim();
        return {
          material: material.trim(),
          operation,
          insert: insert.trim(),
          noseRadius,
          ...(trimmedNote ? { note: trimmedNote } : {}),
        };
      },
    ),
  };
}

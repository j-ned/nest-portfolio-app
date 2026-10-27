import type { WorkshopGuideRow } from '../database/schema/workshop-guide';
import type { UpdateWorkshopGuideDto } from './dto/update-workshop-guide.dto';
import type {
  StoredWorkshopGuideContent,
  WorkshopGuideContent,
  WorkshopGuideDocument,
} from './workshop-guide-content';
import { WORKSHOP_GUIDE_SEED } from './workshop-guide.seed';

/**
 * Contenu stocké ⇒ contenu complet : `decoderEnabled` absent (ligne écrite avant la spec 036) vaut
 * `false`. Recopie champ par champ : rien d'autre ne sort du `jsonb`.
 */
export function toWorkshopGuideContentRead({
  enabled,
  decoderEnabled,
  entries,
}: StoredWorkshopGuideContent): WorkshopGuideContent {
  return { enabled, decoderEnabled: decoderEnabled ?? false, entries };
}

/** Sans document en base : le guide par défaut, désactivé et vide, décodeur éteint, à la version 0. */
export const DEFAULT_WORKSHOP_GUIDE_DOCUMENT: WorkshopGuideDocument = {
  ...toWorkshopGuideContentRead(WORKSHOP_GUIDE_SEED),
  version: 0,
  updatedAt: null,
};

/** Ligne ⇒ réponse publique : contenu à plat (défaut du décodeur appliqué), version, date. */
export function toWorkshopGuideDocument(
  row: WorkshopGuideRow,
): WorkshopGuideDocument {
  return {
    ...toWorkshopGuideContentRead(row.content),
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * Corps validé ⇒ contenu stocké : objets simples recopiés champ par champ (ni `version`, ni
 * instance de DTO dans le `jsonb`), textes rognés, remarque vide omise. Les lignes gardent l'ordre
 * reçu ; le tri d'affichage est celui du front. `decoderEnabled` absent du corps (admin d'avant la
 * spec 036) : `storedDecoderEnabled`, la valeur de la ligne lue, est conservée.
 */
export function toWorkshopGuideContent(
  dto: UpdateWorkshopGuideDto,
  storedDecoderEnabled: boolean,
): WorkshopGuideContent {
  return {
    enabled: dto.enabled,
    decoderEnabled: dto.decoderEnabled ?? storedDecoderEnabled,
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

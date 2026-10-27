import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  WORKSHOP_GUIDE_ROW_ID,
  workshopGuide,
  type WorkshopGuideRow,
} from '../database/schema/workshop-guide';
import { UpdateWorkshopGuideDto } from './dto/update-workshop-guide.dto';
import type { WorkshopGuideDocument } from './workshop-guide-content';
import {
  DEFAULT_WORKSHOP_GUIDE_DOCUMENT,
  toWorkshopGuideContent,
  toWorkshopGuideContentRead,
  toWorkshopGuideDocument,
} from './workshop-guide-document';

/** Guide des plaquettes (spec 035 du front) : un document unique, lu à la requête par le front. */
@Injectable()
export class WorkshopGuideService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Sans ligne en base : le document par défaut (désactivé, vide), jamais un 404. */
  async findCurrent(): Promise<WorkshopGuideDocument> {
    const row = await this.findRow();
    return row ? toWorkshopGuideDocument(row) : DEFAULT_WORKSHOP_GUIDE_DOCUMENT;
  }

  /**
   * Remplace le document sous contrôle de version : un contenu identique à la version lue n'écrit
   * rien ; une version périmée donne 409. Version 0 = création, 409 si la ligne existe déjà.
   * `decoderEnabled` est facultatif dans le corps : absent, la valeur stockée est conservée.
   */
  async replace(dto: UpdateWorkshopGuideDto): Promise<WorkshopGuideDocument> {
    const current = await this.findRow();
    const stored = current
      ? toWorkshopGuideContentRead(current.content)
      : undefined;
    // `decoderEnabled` absent du corps : la valeur de la ligne lue est gardée. Elle n'est écrite que
    // si cette ligne a toujours la version envoyée (mise à jour conditionnelle), sinon 409.
    const content = toWorkshopGuideContent(
      dto,
      stored?.decoderEnabled ?? false,
    );
    // jsonb ne garde pas l'ordre des clés : comparaison structurelle, pas textuelle. Le contenu lu
    // a son défaut appliqué : une ligne sans `decoderEnabled` égale un corps à `false`.
    if (
      current &&
      dto.version === current.version &&
      isDeepStrictEqual(stored, content)
    ) {
      return toWorkshopGuideDocument(current);
    }

    const [row] =
      dto.version === 0
        ? await this.db
            .insert(workshopGuide)
            .values({ id: WORKSHOP_GUIDE_ROW_ID, content })
            .onConflictDoNothing()
            .returning()
        : await this.db
            .update(workshopGuide)
            .set({
              content,
              version: sql`${workshopGuide.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workshopGuide.id, WORKSHOP_GUIDE_ROW_ID),
                eq(workshopGuide.version, dto.version),
              ),
            )
            .returning();
    if (!row) {
      throw new ConflictException(
        'Version périmée : le guide des plaquettes a été modifié depuis sa lecture',
      );
    }

    return toWorkshopGuideDocument(row);
  }

  private async findRow(): Promise<WorkshopGuideRow | undefined> {
    const [row] = await this.db
      .select()
      .from(workshopGuide)
      .where(eq(workshopGuide.id, WORKSHOP_GUIDE_ROW_ID))
      .limit(1);
    return row;
  }
}

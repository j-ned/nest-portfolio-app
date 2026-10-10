import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  PROFILE_ROW_ID,
  profileContent,
  type ProfileContentRow,
} from '../database/schema/profile-content';
import { ImageOptimizer } from '../storage/image-optimizer.service';
import { contentHash } from '../storage/s3-utils';
import { StorageService } from '../storage/storage.service';
import type { ProfileDocument } from './profile-content';
import { inProfileTransaction } from './profile-lock';
import {
  lockProfileRow,
  PROFILE_BUCKET,
  type ProfileTransaction,
  toProfileDocument,
} from './profile-document';

/**
 * Portrait de la page Parcours (spec 021, D6), hors version du document.
 *
 * Une page `/about` déjà servie (onglet ouvert, cache HTTP) cite encore l'ancienne clé : la supprimer
 * tout de suite casserait son image LCP. Chaque changement fait donc glisser les clés (courante →
 * précédente) et ne supprime que l'avant-dernière : au plus un fichier en trop, jamais une image
 * citée absente du bucket.
 *
 * Toute opération qui écrit les clés ou supprime un objet le fait sous le verrou de la ligne
 * (`SELECT … FOR UPDATE`) : les opérations portrait s'exécutent l'une après l'autre, chacune sur
 * l'état laissé par la précédente. Une clé ne peut être réintroduite (même fichier renvoyé : clé
 * adressée par contenu) que sous ce verrou, envoi compris : une suppression décidée sous le verrou
 * ne peut donc jamais retirer un objet cité. L'attente du verrou est bornée (`inProfileTransaction`,
 * 503 au-delà), sa détention aussi (envoi S3 borné, `S3_TIMEOUTS`).
 */
@Injectable()
export class ProfilePortraitService {
  private readonly logger = new Logger(ProfilePortraitService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly images: ImageOptimizer,
  ) {}

  /** Recadre en AVIF 640×800 (hors verrou), puis, verrou tenu : envoi sous une clé hachée et écriture. */
  async replace(file: Express.Multer.File): Promise<ProfileDocument> {
    const image = await this.images.toPortrait(file.buffer);
    // Clé dérivée du contenu : une nouvelle image = une nouvelle URL, servie en cache immuable.
    const key = `profile/portrait-${contentHash(image.buffer)}.${image.ext}`;

    let uploading = false;
    let result: { row: ProfileContentRow; older: string | null };
    try {
      result = await inProfileTransaction(this.db, async (tx) => {
        const current = await lockProfileRow(tx);
        if (key === current.portraitKey) return { row: current, older: null };
        uploading = true;
        await this.storage.upload(
          PROFILE_BUCKET,
          key,
          image.buffer,
          image.mimetype,
        );
        const row = await this.write(tx, current, key);
        return { row, older: current.previousPortraitKey };
      });
    } catch (err) {
      // Transaction annulée : l'objet envoyé n'est orphelin que si la ligne ne le cite pas.
      if (uploading) {
        await this.discardIfUnreferenced(
          key,
          'compensation après écriture en échec',
        );
      }
      throw err;
    }
    await this.discardIfUnreferenced(result.older, 'avant-dernier portrait');
    return this.toDocument(result.row);
  }

  /** Retour au portrait par défaut du front ; la clé retirée est gardée jusqu'au changement suivant. */
  async remove(): Promise<void> {
    const older = await inProfileTransaction(this.db, async (tx) => {
      const current = await lockProfileRow(tx);
      if (!current.portraitKey) return null;
      await this.write(tx, current, null);
      return current.previousPortraitKey;
    });
    await this.discardIfUnreferenced(older, 'avant-dernier portrait');
  }

  /** Fait glisser les clés ; la ligne est verrouillée, elle n'a pas pu changer depuis sa lecture. */
  private async write(
    tx: ProfileTransaction,
    current: ProfileContentRow,
    next: string | null,
  ): Promise<ProfileContentRow> {
    const [row] = await tx
      .update(profileContent)
      .set({
        portraitKey: next,
        previousPortraitKey: current.portraitKey,
        updatedAt: new Date(),
      })
      .where(eq(profileContent.id, PROFILE_ROW_ID))
      .returning();
    return row;
  }

  /**
   * Supprime, verrou tenu, un objet que la ligne ne cite plus (ni courant ni précédent). Après le
   * COMMIT de l'écriture, pour qu'un échec S3 ne l'annule jamais : échec ⇒ orphelin journalisé,
   * jamais une erreur 500.
   */
  private async discardIfUnreferenced(
    key: string | null,
    reason: string,
  ): Promise<void> {
    if (!key) return;
    try {
      await inProfileTransaction(this.db, async (tx) => {
        const row = await lockProfileRow(tx);
        if (key === row.portraitKey || key === row.previousPortraitKey) return;
        await this.storage.delete(PROFILE_BUCKET, key);
      });
    } catch (err) {
      this.logger.error(
        `S3 orphan (${reason}) : ${PROFILE_BUCKET}/${key}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private toDocument(row: ProfileContentRow): ProfileDocument {
    return toProfileDocument(row, (key) =>
      this.storage.getPublicUrl(PROFILE_BUCKET, key),
    );
  }
}

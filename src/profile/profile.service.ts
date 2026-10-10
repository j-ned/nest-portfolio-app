import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  PROFILE_ROW_ID,
  profileContent,
  type ProfileContentRow,
} from '../database/schema/profile-content';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { ProfileDocument } from './profile-content';
import { inProfileTransaction } from './profile-lock';
import {
  findProfileRow,
  PROFILE_BUCKET,
  toProfileContent,
  toProfileDocument,
} from './profile-document';

/** Contenu de la page Parcours (ADR-0023) : un document unique, lu à la requête par le front. */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async findCurrent(): Promise<ProfileDocument> {
    return this.toDocument(await findProfileRow(this.db));
  }

  /**
   * Remplace le document sous contrôle de version : un contenu identique à la version lue n'écrit
   * rien ; une version périmée (autre fenêtre, autre poste) donne 409.
   */
  async replace(dto: UpdateProfileDto): Promise<ProfileDocument> {
    const current = await findProfileRow(this.db);
    const content = toProfileContent(dto);
    // jsonb ne garde pas l'ordre des clés : comparaison structurelle, pas textuelle. Version périmée :
    // l'écriture conditionnelle répond 409, même à contenu égal.
    if (
      dto.version === current.version &&
      isDeepStrictEqual(current.content, content)
    ) {
      return this.toDocument(current);
    }

    // Une opération portrait peut tenir la ligne (verrou pendant son envoi S3) : attente bornée.
    const [row] = await inProfileTransaction(this.db, (tx) =>
      tx
        .update(profileContent)
        .set({
          content,
          version: sql`${profileContent.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(profileContent.id, PROFILE_ROW_ID),
            eq(profileContent.version, dto.version),
          ),
        )
        .returning(),
    );
    if (!row) {
      throw new ConflictException(
        'Version périmée : le parcours a été modifié depuis sa lecture',
      );
    }

    return this.toDocument(row);
  }

  private toDocument(row: ProfileContentRow): ProfileDocument {
    return toProfileDocument(row, (key) =>
      this.storage.getPublicUrl(PROFILE_BUCKET, key),
    );
  }
}

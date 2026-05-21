import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { profile, type Profile } from '../database/schema';
import { StorageService } from '../storage/storage.service';
import { deleteS3IfExists } from '../storage/s3-utils';
import { mimeToExt } from '../common/utils';

@Injectable()
export class ProfileService {
  private static readonly BUCKET = 'portfolio-storage';

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async findOne(): Promise<Profile> {
    const row = await this.findOneRaw();
    return this.toResponse(row);
  }

  async uploadAvatar(file: Express.Multer.File): Promise<Profile> {
    const current = await this.findOneRaw();
    const newKey = `avatar/avatar.${mimeToExt(file.mimetype)}`;

    // Ordre : upload → update DB → cleanup ancienne clé.
    // Si une étape échoue, on préfère un orphelin S3 (cleanup manuel possible)
    // à une DB qui référence une clé supprimée (image cassée côté front).
    await this.storage.upload(
      ProfileService.BUCKET,
      newKey,
      file.buffer,
      file.mimetype,
    );

    const [row] = await this.db
      .update(profile)
      .set({ avatarUrl: newKey, updatedAt: new Date() })
      .where(eq(profile.id, current.id))
      .returning();

    if (current.avatarUrl !== newKey) {
      await deleteS3IfExists(
        this.storage,
        ProfileService.BUCKET,
        current.avatarUrl,
      );
    }

    return this.toResponse(row);
  }

  // Helper privé : retourne la row brute (sans transformation URL).
  // Utilisé par toutes les opérations internes qui ont besoin de la key S3.
  private async findOneRaw(): Promise<Profile> {
    const rows = await this.db.select().from(profile).limit(1);
    if (rows.length === 0) {
      throw new InternalServerErrorException(
        'Profile singleton missing — did you run the migration?',
      );
    }
    return rows[0];
  }

  // Transforme la key DB en URL publique pour la sortie API.
  // L'avatarUrl est soit '' (pas d'avatar), soit l'URL S3 publique complète.
  private toResponse(p: Profile): Profile {
    return {
      ...p,
      avatarUrl: p.avatarUrl
        ? this.storage.getPublicUrl(ProfileService.BUCKET, p.avatarUrl)
        : '',
    };
  }
}

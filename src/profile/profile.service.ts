import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  profile,
  type NewProfile,
  type Profile,
} from '../database/schema/profile';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MIME_TO_EXT } from '../projects/projects.utils';

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

  async update(dto: UpdateProfileDto): Promise<Profile> {
    const current = await this.findOneRaw();

    // avatarUrl extrait du spread : il ne peut être que null ou undefined côté DTO,
    // mais on ne veut jamais qu'il soit propagé tel quel dans le patch DB
    // (la column est NOT NULL DEFAULT '').
    const { avatarUrl, ...rest } = dto;
    const patch: Partial<NewProfile> = { ...rest, updatedAt: new Date() };
    if (avatarUrl === null) patch.avatarUrl = '';

    const [row] = await this.db
      .update(profile)
      .set(patch)
      .where(eq(profile.id, current.id))
      .returning();

    // Cleanup S3 APRÈS le write DB réussi : si le write échoue, on préfère
    // garder l'objet S3 (orphelin DB-cohérent) plutôt qu'une DB cassée.
    if (avatarUrl === null && current.avatarUrl) {
      await this.storage.delete(ProfileService.BUCKET, current.avatarUrl);
    }

    return this.toResponse(row);
  }

  async uploadAvatar(file: Express.Multer.File): Promise<Profile> {
    const current = await this.findOneRaw();

    const ext = MIME_TO_EXT[file.mimetype];
    const newKey = `avatar/avatar.${ext}`;

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

    if (current.avatarUrl && current.avatarUrl !== newKey) {
      await this.storage.delete(ProfileService.BUCKET, current.avatarUrl);
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

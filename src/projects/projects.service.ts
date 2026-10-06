import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  projects,
  type NewProject,
  type Project,
} from '../database/schema/projects';
import { StorageService } from '../storage/storage.service';
import { ImageOptimizer } from '../storage/image-optimizer.service';
import { contentHash, deleteS3IfExists } from '../storage/s3-utils';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import type { ProjectImageResponse, ProjectResponse } from './project-gallery';
import { ProjectImagesService } from './project-images.service';
import { findByIdOrFail } from '../common/crud-helpers';
import { isUniqueViolation, slugify } from '../common/utils';

@Injectable()
export class ProjectsService {
  private static readonly BUCKET = 'portfolio-storage';
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly images: ImageOptimizer,
    private readonly gallery: ProjectImagesService,
  ) {}

  async findAll(filters: {
    category?: string;
    featured?: boolean;
  }): Promise<ProjectResponse[]> {
    const conditions: SQL[] = [];
    if (filters.category)
      conditions.push(eq(projects.category, filters.category));
    if (filters.featured) conditions.push(eq(projects.featured, true));

    const rows = await this.db
      .select()
      .from(projects)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(projects.order), desc(projects.createdAt));
    const galleries = await this.gallery.galleryOf(rows.map((r) => r.id));
    return rows.map((r) => this.toResponse(r, galleries.get(r.id) ?? []));
  }

  async findById(id: string): Promise<ProjectResponse> {
    const row = await this.findByIdRaw(id);
    return this.toResponse(row, await this.galleryOfOne(id));
  }

  async create(dto: CreateProjectDto): Promise<ProjectResponse> {
    const slug = slugify(dto.title);
    try {
      const [row] = await this.db
        .insert(projects)
        .values({ ...dto, slug })
        .returning();
      return this.toResponse(row, []);
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(
          `Project with slug "${slug}" already exists`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectResponse> {
    const current = await this.findByIdRaw(id);

    // image extrait du spread : il ne peut être que null ou undefined côté DTO,
    // mais on ne veut jamais qu'il soit propagé tel quel dans le patch DB
    // (la column est NOT NULL DEFAULT '').
    const { image, ...rest } = dto;
    const patch: Partial<NewProject> = { ...rest, updatedAt: new Date() };
    if (dto.title !== undefined) patch.slug = slugify(dto.title);
    if (image === null) patch.image = '';

    let row: Project;
    try {
      [row] = await this.db
        .update(projects)
        .set(patch)
        .where(eq(projects.id, id))
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(
          `Project with slug "${patch.slug}" already exists`,
        );
      }
      throw err;
    }

    // S3 cleanup APRÈS le write DB réussi : si le write échoue, on préfère
    // garder l'objet S3 (orphelin DB-cohérent) plutôt qu'une DB cassée.
    if (image === null) {
      await deleteS3IfExists(
        this.storage,
        ProjectsService.BUCKET,
        current.image,
      );
    }

    return this.toResponse(row, await this.galleryOfOne(id));
  }

  async remove(id: string): Promise<void> {
    const current = await this.findByIdRaw(id);
    // Les lignes de galerie partent par cascade : leurs clés S3 sont lues avant, effacées après.
    const galleryKeys = await this.gallery.keysOf(id);
    await this.db.delete(projects).where(eq(projects.id, id));

    // La ligne est partie : un échec S3 ne laisse qu'un orphelin, logué, jamais une erreur 500.
    const keys = [current.image, ...galleryKeys];
    const results = await Promise.allSettled(
      keys.map((key) =>
        deleteS3IfExists(this.storage, ProjectsService.BUCKET, key),
      ),
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `S3 orphan after deleting project ${id}: ${keys[i]}`,
          result.reason instanceof Error
            ? result.reason.stack
            : String(result.reason),
        );
      }
    });
  }

  async uploadImage(
    id: string,
    file: Express.Multer.File,
  ): Promise<ProjectResponse> {
    const current = await this.findByIdRaw(id);
    // Quel que soit le format reçu, on stocke un AVIF ≤ 1600 px : le poids servi ne dépend
    // plus de l'export de l'admin (un JPEG photo de 2,8 Mo tombait en l'état sur la page).
    const image = await this.images.optimize(file.buffer);
    // Clé dérivée du contenu : chaque nouvelle image a une nouvelle URL, l'ancienne peut donc être
    // servie avec un cache immuable d'un an sans jamais afficher une image remplacée.
    const newKey = `projects/${id}-${contentHash(image.buffer)}.${image.ext}`;

    // Ordre : upload → update DB → cleanup ancienne clé.
    // Si une étape échoue, on préfère un orphelin S3 (cleanup manuel possible)
    // à une DB qui référence une clé supprimée (image cassée côté front).
    await this.storage.upload(
      ProjectsService.BUCKET,
      newKey,
      image.buffer,
      image.mimetype,
    );

    const [row] = await this.db
      .update(projects)
      .set({ image: newKey, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();

    if (current.image !== newKey) {
      await deleteS3IfExists(
        this.storage,
        ProjectsService.BUCKET,
        current.image,
      );
    }

    return this.toResponse(row, await this.galleryOfOne(id));
  }

  // Helper privé : retourne la row brute (sans transformation URL).
  // Utilisé par toutes les opérations internes qui ont besoin de la key S3.
  private findByIdRaw(id: string): Promise<Project> {
    return findByIdOrFail<Project>(this.db, projects, id, 'Project');
  }

  private async galleryOfOne(
    id: string,
  ): Promise<readonly ProjectImageResponse[]> {
    return (await this.gallery.galleryOf([id])).get(id) ?? [];
  }

  // Transforme la key DB en URL publique pour la sortie API, galerie jointe (ADR-0009 §4).
  private toResponse(
    p: Project,
    gallery: readonly ProjectImageResponse[],
  ): ProjectResponse {
    return {
      ...p,
      gallery,
      image: p.image
        ? this.storage.getPublicUrl(ProjectsService.BUCKET, p.image)
        : '',
    };
  }
}

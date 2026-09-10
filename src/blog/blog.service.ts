import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  blogPosts,
  type NewBlogPost,
  type BlogPost,
} from '../database/schema/blog-posts';
import { StorageService } from '../storage/storage.service';
import { ImageOptimizer } from '../storage/image-optimizer.service';
import { deleteS3IfExists } from '../storage/s3-utils';
import { AppConfigService } from '../config/app-config.service';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { findByIdOrFail } from '../common/crud-helpers';
import { isUniqueViolation, slugify, fireAndForget } from '../common/utils';

@Injectable()
export class BlogService {
  private static readonly BUCKET = 'portfolio-storage';
  private readonly logger = new Logger(BlogService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
    private readonly images: ImageOptimizer,
  ) {}

  async findAllPublished(): Promise<BlogPost[]> {
    const rows = await this.db
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.status, 'published'))
      .orderBy(desc(blogPosts.publishedAt));
    return rows.map((r) => this.toResponse(r));
  }

  async findAllForAdmin(): Promise<BlogPost[]> {
    const rows = await this.db
      .select()
      .from(blogPosts)
      .orderBy(desc(blogPosts.createdAt));
    return rows.map((r) => this.toResponse(r));
  }

  async findBySlug(slug: string): Promise<BlogPost> {
    const rows = await this.db
      .select()
      .from(blogPosts)
      .where(this.publishedSlugFilter(slug))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Blog post "${slug}" not found`);
    }
    return this.toResponse(rows[0]);
  }

  async create(dto: CreateBlogPostDto): Promise<BlogPost> {
    const slug = slugify(dto.title);
    const publishedAt = dto.status === 'published' ? new Date() : null;
    try {
      const [row] = await this.db
        .insert(blogPosts)
        .values({ ...dto, slug, publishedAt })
        .returning();
      if (dto.status === 'published') this.triggerDeploy();
      return this.toResponse(row);
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(
          `Blog post with slug "${slug}" already exists`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateBlogPostDto): Promise<BlogPost> {
    const current = await this.findByIdRaw(id);

    // coverImage extrait du spread : il ne peut être que null ou undefined
    // côté DTO (upload géré par POST /:id/image), mais on ne veut jamais
    // qu'il soit propagé tel quel dans le patch DB (colonne NOT NULL DEFAULT '').
    const { coverImage, ...rest } = dto;
    const patch: Partial<NewBlogPost> = { ...rest, updatedAt: new Date() };
    // Le slug EST l'URL publique (et la clé du thread Giscus, mappé sur le
    // pathname) : une fois l'article publié, on le fige - un titre édité
    // après coup ne doit plus casser les liens entrants/le thread existant.
    if (dto.title !== undefined && current.publishedAt === null) {
      patch.slug = slugify(dto.title);
    }
    if (coverImage === null) patch.coverImage = '';

    const isPublishing =
      dto.status === 'published' && current.status !== 'published';
    if (isPublishing) patch.publishedAt = new Date();

    // Rebuild Dokploy dès que le patch change ce qui doit être visible sur le
    // site statique : passage en published (transition ou simple édition de
    // contenu déjà publié), ou dépublication (published -> draft).
    const newStatus = dto.status ?? current.status;
    const shouldDeploy =
      newStatus === 'published' || current.status === 'published';

    let row: BlogPost;
    try {
      [row] = await this.db
        .update(blogPosts)
        .set(patch)
        .where(eq(blogPosts.id, id))
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) {
        throw new ConflictException(
          `Blog post with slug "${patch.slug}" already exists`,
        );
      }
      throw err;
    }

    // S3 cleanup APRÈS le write DB réussi : si le write échoue, on préfère
    // garder l'objet S3 (orphelin DB-cohérent) plutôt qu'une DB cassée.
    if (coverImage === null) {
      await deleteS3IfExists(
        this.storage,
        BlogService.BUCKET,
        current.coverImage,
      );
    }
    if (shouldDeploy) this.triggerDeploy();

    return this.toResponse(row);
  }

  async remove(id: string): Promise<void> {
    const current = await this.findByIdRaw(id);
    await this.db.delete(blogPosts).where(eq(blogPosts.id, id));
    await deleteS3IfExists(
      this.storage,
      BlogService.BUCKET,
      current.coverImage,
    );
    // Un article publié disparaît du site statique seulement après rebuild.
    if (current.status === 'published') this.triggerDeploy();
  }

  async uploadCoverImage(
    id: string,
    file: Express.Multer.File,
  ): Promise<BlogPost> {
    const current = await this.findByIdRaw(id);
    // Quel que soit le format reçu, on stocke un AVIF ≤ 1600 px : le poids servi ne dépend
    // plus de l'export de l'admin (un JPEG photo de 2,8 Mo tombait en l'état sur la page).
    const image = await this.images.optimize(file.buffer);
    const newKey = `blog/${id}.${image.ext}`;

    // Ordre : upload → update DB → cleanup ancienne clé.
    // Si une étape échoue, on préfère un orphelin S3 (cleanup manuel possible)
    // à une DB qui référence une clé supprimée (image cassée côté front).
    await this.storage.upload(
      BlogService.BUCKET,
      newKey,
      image.buffer,
      image.mimetype,
    );

    const [row] = await this.db
      .update(blogPosts)
      .set({ coverImage: newKey, updatedAt: new Date() })
      .where(eq(blogPosts.id, id))
      .returning();

    if (current.coverImage !== newKey) {
      await deleteS3IfExists(
        this.storage,
        BlogService.BUCKET,
        current.coverImage,
      );
    }

    return this.toResponse(row);
  }

  async like(slug: string): Promise<{ likesCount: number }> {
    // Incrément atomique côté DB (pas de read-then-write applicatif) pour
    // éviter une race condition entre deux likes concurrents. Le filtre
    // status='published' est appliqué dans la même requête (plutôt qu'un
    // find préalable) pour ne pas sacrifier cette atomicité.
    const [row] = await this.db
      .update(blogPosts)
      .set({ likesCount: sql`${blogPosts.likesCount} + 1` })
      .where(this.publishedSlugFilter(slug))
      .returning();
    if (!row) throw new NotFoundException(`Blog post "${slug}" not found`);
    return { likesCount: row.likesCount };
  }

  // Helper privé : retourne la row brute (sans transformation URL).
  // Utilisé par toutes les opérations internes qui ont besoin de la key S3.
  private findByIdRaw(id: string): Promise<BlogPost> {
    return findByIdOrFail<BlogPost>(this.db, blogPosts, id, 'Blog post');
  }

  // Filtre partagé slug + status='published' : un draft (ou un post
  // dépublié) doit 404 exactement comme un slug inexistant, aussi bien en
  // lecture (findBySlug) qu'en écriture (like).
  private publishedSlugFilter(slug: string) {
    return and(eq(blogPosts.slug, slug), eq(blogPosts.status, 'published'));
  }

  // Publier un article déclenche un rebuild : les pages /blog sont prerendered
  // au build (pas de SSR par requête en prod, cf. spec), donc rien n'est
  // visible tant que le site n'a pas été reconstruit et redéployé.
  private triggerDeploy(): void {
    const url = this.config.dokployDeployWebhookUrl;
    if (!url) return;
    fireAndForget(
      fetch(url, { method: 'POST', signal: AbortSignal.timeout(5_000) }).then(
        (res) => {
          if (!res.ok) {
            throw new Error(`Dokploy webhook responded ${res.status}`);
          }
        },
      ),
      this.logger,
      'dokploy-deploy-webhook',
    );
  }

  // Transforme la key DB en URL publique pour la sortie API.
  private toResponse(p: BlogPost): BlogPost {
    return {
      ...p,
      coverImage: p.coverImage
        ? this.storage.getPublicUrl(BlogService.BUCKET, p.coverImage)
        : '',
    };
  }
}

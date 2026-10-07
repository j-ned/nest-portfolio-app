import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { BlogService } from './blog.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { StorageService } from '../storage/storage.service';
import { ImageOptimizer } from '../storage/image-optimizer.service';
import { AppConfigService } from '../config/app-config.service';
import { BlogContentImagesService } from './blog-content-images.service';
import {
  blogPosts,
  type BlogPost,
  type NewBlogPost,
} from '../database/schema/blog-posts';

describe('BlogService', () => {
  let service: BlogService;
  let db: ReturnType<typeof createMockDb>;
  let storage: jest.Mocked<StorageService>;
  let config: jest.Mocked<AppConfigService>;
  let contentImages: { removeUnreferenced: jest.Mock };

  const mkPost = (overrides: Partial<BlogPost> = {}): BlogPost => ({
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Mon article',
    slug: 'mon-article',
    excerpt: 'Résumé',
    contentMarkdown: '# Titre',
    coverImage: '',
    tags: [],
    status: 'draft',
    likesCount: 0,
    publishedAt: null,
    createdAt: new Date('2026-08-31T00:00:00Z'),
    updatedAt: new Date('2026-08-31T00:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      list: jest.fn(),
      getPublicUrl: jest.fn().mockReturnValue('https://example.test/url'),
    } as unknown as jest.Mocked<StorageService>;
    config = {
      dokployDeployWebhookUrl: undefined,
    } as unknown as jest.Mocked<AppConfigService>;
    contentImages = {
      removeUnreferenced: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storage },
        { provide: AppConfigService, useValue: config },
        { provide: BlogContentImagesService, useValue: contentImages },
        {
          provide: ImageOptimizer,
          useValue: {
            optimize: jest.fn().mockResolvedValue({
              buffer: Buffer.from('avif-bytes'),
              mimetype: 'image/avif',
              ext: 'avif',
              width: 1600,
              height: 900,
            }),
          },
        },
      ],
    }).compile();
    service = module.get(BlogService);
  });

  describe('findAllPublished', () => {
    it('ne retourne que les articles publiés, triés par date de publication décroissante', async () => {
      db.orderBy.mockResolvedValueOnce([mkPost({ status: 'published' })]);
      const result = await service.findAllPublished();
      expect(result).toHaveLength(1);
      expect(db.where).toHaveBeenCalled();
    });
  });

  describe('findBySlug', () => {
    it("lève NotFoundException si le slug n'existe pas", async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findBySlug('inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('retourne le post transformé (coverImage en URL) si trouvé', async () => {
      db.limit.mockResolvedValueOnce([mkPost({ coverImage: 'blog/a.webp' })]);
      const result = await service.findBySlug('mon-article');
      expect(result.coverImage).toBe('https://example.test/url');
    });

    it('lève NotFoundException pour un slug draft - un brouillon 404 exactement comme un slug inconnu', async () => {
      // La requête filtre désormais status='published' : un draft ne remonte
      // aucune ligne, même si le slug existe bien en DB.
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findBySlug('un-brouillon')).rejects.toThrow(
        NotFoundException,
      );
      expect(db.where).toHaveBeenCalledWith(
        and(
          eq(blogPosts.slug, 'un-brouillon'),
          eq(blogPosts.status, 'published'),
        ),
      );
    });
  });

  describe('create', () => {
    it('génère le slug depuis le titre', async () => {
      db.returning.mockResolvedValueOnce([
        mkPost({ slug: 'un-nouvel-article' }),
      ]);
      await service.create({
        title: 'Un nouvel article',
        excerpt: 'x',
        contentMarkdown: 'x',
        status: 'draft',
      });
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'un-nouvel-article' }),
      );
    });

    it('lève ConflictException si le slug existe déjà', async () => {
      db.returning.mockRejectedValueOnce({
        code: '23505',
        constraint_name: 'blog_post_slug_unique',
      });
      await expect(
        service.create({ title: 'x', excerpt: 'x', contentMarkdown: 'x' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update — rebuild Dokploy quand le rendu du site public change', () => {
    it('appelle fetch sur le webhook si configuré et le nouveau statut est published (transition draft → published)', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      config.dokployDeployWebhookUrl =
        'https://dokploy.example.test/webhook/abc';
      db.limit.mockResolvedValueOnce([mkPost({ status: 'draft' })]); // findByIdRaw
      db.returning.mockResolvedValueOnce([mkPost({ status: 'published' })]);

      await service.update('11111111-1111-1111-1111-111111111111', {
        status: 'published',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://dokploy.example.test/webhook/abc',
        expect.objectContaining({ method: 'POST' }),
      );
      fetchSpy.mockRestore();
    });

    it("n'appelle pas fetch si le webhook n'est pas configuré", async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      config.dokployDeployWebhookUrl = undefined;
      db.limit.mockResolvedValueOnce([mkPost({ status: 'draft' })]);
      db.returning.mockResolvedValueOnce([mkPost({ status: 'published' })]);

      await service.update('11111111-1111-1111-1111-111111111111', {
        status: 'published',
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("appelle fetch quand on édite le contenu d'un article déjà publié, sans toucher au statut (fix : l'ancien latch draft→published bloquait ce cas)", async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      config.dokployDeployWebhookUrl =
        'https://dokploy.example.test/webhook/abc';
      db.limit.mockResolvedValueOnce([
        mkPost({ status: 'published', publishedAt: new Date('2026-01-01') }),
      ]); // findByIdRaw
      db.returning.mockResolvedValueOnce([mkPost({ status: 'published' })]);

      await service.update('11111111-1111-1111-1111-111111111111', {
        excerpt: 'Résumé corrigé',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://dokploy.example.test/webhook/abc',
        expect.objectContaining({ method: 'POST' }),
      );
      fetchSpy.mockRestore();
    });

    it('appelle fetch lors de la dépublication (published → draft)', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      config.dokployDeployWebhookUrl =
        'https://dokploy.example.test/webhook/abc';
      db.limit.mockResolvedValueOnce([
        mkPost({ status: 'published', publishedAt: new Date('2026-01-01') }),
      ]);
      db.returning.mockResolvedValueOnce([mkPost({ status: 'draft' })]);

      await service.update('11111111-1111-1111-1111-111111111111', {
        status: 'draft',
      });

      expect(fetchSpy).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("n'appelle pas fetch quand on édite un draft sans le publier", async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      config.dokployDeployWebhookUrl =
        'https://dokploy.example.test/webhook/abc';
      db.limit.mockResolvedValueOnce([mkPost({ status: 'draft' })]);
      db.returning.mockResolvedValueOnce([mkPost({ status: 'draft' })]);

      await service.update('11111111-1111-1111-1111-111111111111', {
        excerpt: 'x',
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('log une erreur (sans throw) si le webhook Dokploy répond avec un statut non-ok', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 500 }));
      config.dokployDeployWebhookUrl =
        'https://dokploy.example.test/webhook/abc';
      db.limit.mockResolvedValueOnce([mkPost({ status: 'draft' })]);
      db.returning.mockResolvedValueOnce([mkPost({ status: 'published' })]);

      await service.update('11111111-1111-1111-1111-111111111111', {
        status: 'published',
      });
      // fireAndForget attache le .catch en microtask : laisser la promesse
      // rejetée se propager avant d'assertionner le log.
      await new Promise((resolve) => setImmediate(resolve));

      expect(errorSpy).toHaveBeenCalledWith(
        'dokploy-deploy-webhook',
        expect.stringContaining('Dokploy webhook responded 500'),
      );
      errorSpy.mockRestore();
      fetchSpy.mockRestore();
    });
  });

  describe('update — gel du slug après publication', () => {
    it("ne régénère pas le slug quand on édite le titre d'un article déjà publié", async () => {
      db.limit.mockResolvedValueOnce([
        mkPost({
          status: 'published',
          publishedAt: new Date('2026-01-01'),
          slug: 'ancien-slug',
        }),
      ]);
      db.returning.mockResolvedValueOnce([
        mkPost({ status: 'published', slug: 'ancien-slug' }),
      ]);

      await service.update('11111111-1111-1111-1111-111111111111', {
        title: 'Nouveau titre qui pourrait re-slugifier',
      });

      const calls = db.set.mock.calls as Array<[Partial<NewBlogPost>]>;
      expect(calls[0][0].slug).toBeUndefined();
    });

    it("régénère le slug quand on édite le titre d'un article jamais publié (draft)", async () => {
      db.limit.mockResolvedValueOnce([
        mkPost({ status: 'draft', publishedAt: null, slug: 'ancien-slug' }),
      ]);
      db.returning.mockResolvedValueOnce([
        mkPost({ status: 'draft', slug: 'nouveau-titre' }),
      ]);

      await service.update('11111111-1111-1111-1111-111111111111', {
        title: 'Nouveau titre',
      });

      const calls = db.set.mock.calls as Array<[Partial<NewBlogPost>]>;
      expect(calls[0][0].slug).toBe('nouveau-titre');
    });
  });

  describe('remove — rebuild Dokploy si l’article supprimé était publié', () => {
    it("appelle fetch si l'article supprimé était publié", async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      config.dokployDeployWebhookUrl =
        'https://dokploy.example.test/webhook/abc';
      db.limit.mockResolvedValueOnce([mkPost({ status: 'published' })]); // findByIdRaw

      await service.remove('11111111-1111-1111-1111-111111111111');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://dokploy.example.test/webhook/abc',
        expect.objectContaining({ method: 'POST' }),
      );
      fetchSpy.mockRestore();
    });

    it("n'appelle pas fetch si l'article supprimé était un draft", async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      config.dokployDeployWebhookUrl =
        'https://dokploy.example.test/webhook/abc';
      db.limit.mockResolvedValueOnce([mkPost({ status: 'draft' })]);

      await service.remove('11111111-1111-1111-1111-111111111111');

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('remove — images du corps (spec 016, A2)', () => {
    const ID = '11111111-1111-1111-1111-111111111111';
    const KEY_A =
      'blog-content/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-a1b2c3d4-1600x900.avif';
    const KEY_B =
      'blog-content/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-deadbeef-800x600.avif';
    const markdown = [
      '# Titre',
      `![a](https://api.nedellec-julien.fr/api/storage/portfolio-storage/${KEY_A})`,
      `![b](/storage/portfolio-storage/${KEY_B})`,
      `![a encore](/storage/portfolio-storage/${KEY_A})`,
      '![externe](https://example.com/photo.avif)',
    ].join('\n\n');

    it('Given a post citing body images, When removed, Then its cited keys are handed over for cleanup, excluding itself', async () => {
      db.limit.mockResolvedValueOnce([
        mkPost({ contentMarkdown: markdown, coverImage: 'blog/cover.avif' }),
      ]);

      await service.remove(ID);

      expect(contentImages.removeUnreferenced).toHaveBeenCalledWith(
        [KEY_A, KEY_B],
        ID,
      );
    });

    it('Given a post, When removed, Then the row is deleted before any storage cleanup', async () => {
      db.limit.mockResolvedValueOnce([
        mkPost({ contentMarkdown: markdown, coverImage: 'blog/cover.avif' }),
      ]);

      await service.remove(ID);

      const dbDelete = db.delete.mock.invocationCallOrder[0];
      expect(dbDelete).toBeLessThan(storage.delete.mock.invocationCallOrder[0]);
      expect(dbDelete).toBeLessThan(
        contentImages.removeUnreferenced.mock.invocationCallOrder[0],
      );
    });

    it('Given a post with a cover, When removed, Then the cover is still deleted as before', async () => {
      db.limit.mockResolvedValueOnce([
        mkPost({ contentMarkdown: markdown, coverImage: 'blog/cover.avif' }),
      ]);

      await service.remove(ID);

      expect(storage.delete.mock.calls).toContainEqual([
        'portfolio-storage',
        'blog/cover.avif',
      ]);
    });

    it('Given a post without body images, When removed, Then the cleanup receives no key', async () => {
      db.limit.mockResolvedValueOnce([mkPost({ contentMarkdown: '# Titre' })]);

      await service.remove(ID);

      expect(contentImages.removeUnreferenced).toHaveBeenCalledWith([], ID);
    });

    it('Given the cover deletion fails, When removed, Then the body cleanup still runs, the error is logged and the removal succeeds', async () => {
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      db.limit.mockResolvedValueOnce([
        mkPost({ contentMarkdown: markdown, coverImage: 'blog/cover.avif' }),
      ]);
      storage.delete.mockRejectedValueOnce(new Error('S3 down'));

      await expect(service.remove(ID)).resolves.toBeUndefined();

      expect(contentImages.removeUnreferenced).toHaveBeenCalledWith(
        [KEY_A, KEY_B],
        ID,
      );
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('blog/cover.avif'),
        expect.anything(),
      );
      logError.mockRestore();
    });

    it('Given the cleanup fails, When removed, Then the removal still succeeds and the error is logged', async () => {
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      db.limit.mockResolvedValueOnce([mkPost({ contentMarkdown: markdown })]);
      contentImages.removeUnreferenced.mockRejectedValueOnce(
        new Error('DB down'),
      );

      await expect(service.remove(ID)).resolves.toBeUndefined();

      expect(db.delete).toHaveBeenCalled();
      expect(logError).toHaveBeenCalled();
      logError.mockRestore();
    });
  });

  describe('like', () => {
    it('incrémente likesCount et retourne la nouvelle valeur', async () => {
      db.returning.mockResolvedValueOnce([mkPost({ likesCount: 4 })]);
      const result = await service.like('mon-article');
      expect(result).toEqual({ likesCount: 4 });
    });

    it('lève NotFoundException pour un slug draft - pas de like sur un post non publié', async () => {
      // Le filtre status='published' est intégré à la requête UPDATE elle-même
      // (atomicité conservée) : un draft ne matche aucune ligne.
      db.returning.mockResolvedValueOnce([]);
      await expect(service.like('un-brouillon')).rejects.toThrow(
        NotFoundException,
      );
      expect(db.where).toHaveBeenCalledWith(
        and(
          eq(blogPosts.slug, 'un-brouillon'),
          eq(blogPosts.status, 'published'),
        ),
      );
    });
  });
});

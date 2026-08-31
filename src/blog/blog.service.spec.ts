import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BlogService } from './blog.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { StorageService } from '../storage/storage.service';
import { AppConfigService } from '../config/app-config.service';
import type { BlogPost } from '../database/schema/blog-posts';

describe('BlogService', () => {
  let service: BlogService;
  let db: ReturnType<typeof createMockDb>;
  let storage: jest.Mocked<StorageService>;
  let config: jest.Mocked<AppConfigService>;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storage },
        { provide: AppConfigService, useValue: config },
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

  describe('update — passage en published déclenche le webhook Dokploy', () => {
    it('appelle fetch sur le webhook si configuré et le nouveau statut est published', async () => {
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
        { method: 'POST' },
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
  });

  describe('like', () => {
    it('incrémente likesCount et retourne la nouvelle valeur', async () => {
      db.returning.mockResolvedValueOnce([mkPost({ likesCount: 4 })]);
      const result = await service.like('mon-article');
      expect(result).toEqual({ likesCount: 4 });
    });
  });
});

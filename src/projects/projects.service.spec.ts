/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { StorageService } from '../storage/storage.service';
import type { Project } from '../database/schema/projects';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let db: ReturnType<typeof createMockDb>;
  let storage: jest.Mocked<StorageService>;

  const mkProject = (overrides: Partial<Project> = {}): Project => ({
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Mon site',
    slug: 'mon-site',
    category: 'web',
    tags: [],
    description: 'Description',
    image: '',
    liveUrl: null,
    repoUrl: null,
    repoUrlFront: null,
    repoUrlBack: null,
    featured: false,
    order: 0,
    createdAt: new Date('2026-04-26T00:00:00Z'),
    updatedAt: new Date('2026-04-26T00:00:00Z'),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(ProjectsService);
  });

  describe('findAll', () => {
    it('retourne tous les projets, triés order ASC, createdAt DESC', async () => {
      const rows = [mkProject({ id: 'a' }), mkProject({ id: 'b' })];
      db.orderBy.mockResolvedValueOnce(rows);
      await expect(service.findAll({})).resolves.toEqual(rows);
    });

    it('applique filtre category', async () => {
      db.orderBy.mockResolvedValueOnce([]);
      await service.findAll({ category: 'web' });
      expect(db.where).toHaveBeenCalled();
    });

    it('applique filtre featured', async () => {
      db.orderBy.mockResolvedValueOnce([]);
      await service.findAll({ featured: true });
      expect(db.where).toHaveBeenCalled();
    });

    it('applique les deux filtres combinés', async () => {
      db.orderBy.mockResolvedValueOnce([]);
      await service.findAll({ category: 'web', featured: true });
      expect(db.where).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('retourne le projet', async () => {
      const row = mkProject();
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findById(row.id)).resolves.toEqual(row);
    });

    it('throw NotFoundException si absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('insère avec slug auto-calculé depuis title', async () => {
      const created = mkProject({ title: 'Mon site', slug: 'mon-site' });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({
        title: 'Mon site',
        category: 'web',
        description: 'desc',
      });
      expect(result.slug).toBe('mon-site');
    });

    it('normalise les accents dans le slug', async () => {
      const created = mkProject({ title: 'Mon Été', slug: 'mon-ete' });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({
        title: 'Mon Été',
        category: 'web',
        description: 'desc',
      });
      expect(result.slug).toBe('mon-ete');
    });

    it('throw ConflictException sur unique violation slug', async () => {
      db.returning.mockRejectedValueOnce({
        code: '23505',
        constraint_name: 'project_slug_unique',
      });
      await expect(
        service.create({
          title: 'Mon site',
          category: 'web',
          description: 'desc',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('throw NotFoundException si projet absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.update('nope', { title: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('re-slugifie si title change', async () => {
      const current = mkProject();
      const updated = mkProject({ title: 'Nouveau', slug: 'nouveau' });
      db.limit.mockResolvedValueOnce([current]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.update(current.id, { title: 'Nouveau' });
      expect(result.slug).toBe('nouveau');
    });

    it('image: null + image existante → storage.delete + image=""', async () => {
      const current = mkProject({ image: 'projects/<id>.webp' });
      const updated = mkProject({ image: '' });
      db.limit.mockResolvedValueOnce([current]);
      db.returning.mockResolvedValueOnce([updated]);
      await service.update(current.id, { image: null });
      expect(storage.delete).toHaveBeenCalledWith(
        'portfolio-storage',
        'projects/<id>.webp',
      );
    });

    it("image: null + pas d'image existante → ne touche pas S3", async () => {
      const current = mkProject({ image: '' });
      const updated = mkProject({ image: '' });
      db.limit.mockResolvedValueOnce([current]);
      db.returning.mockResolvedValueOnce([updated]);
      await service.update(current.id, { image: null });
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('throw ConflictException sur unique violation slug', async () => {
      db.limit.mockResolvedValueOnce([mkProject()]);
      db.returning.mockRejectedValueOnce({
        code: '23505',
        constraint_name: 'project_slug_unique',
      });
      await expect(
        service.update('11111111-1111-1111-1111-111111111111', {
          title: 'Collision',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('throw NotFoundException si absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });

    it('supprime image S3 puis row DB si image présente', async () => {
      const current = mkProject({ image: 'projects/<id>.webp' });
      db.limit.mockResolvedValueOnce([current]);
      db.where.mockResolvedValueOnce(undefined);
      await service.remove(current.id);
      expect(storage.delete).toHaveBeenCalledWith(
        'portfolio-storage',
        'projects/<id>.webp',
      );
    });

    it("ne touche pas S3 si pas d'image", async () => {
      const current = mkProject({ image: '' });
      db.limit.mockResolvedValueOnce([current]);
      db.where.mockResolvedValueOnce(undefined);
      await service.remove(current.id);
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('uploadImage', () => {
    const file = {
      buffer: Buffer.from('fake'),
      mimetype: 'image/webp',
      size: 100,
    } as Express.Multer.File;

    it('throw NotFoundException si projet absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.uploadImage('nope', file)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("upload puis update DB, pas de delete si pas d'image existante", async () => {
      const current = mkProject({ image: '' });
      db.limit.mockResolvedValueOnce([current]);
      db.where.mockResolvedValueOnce(undefined);
      const result = await service.uploadImage(current.id, file);
      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        `projects/${current.id}.webp`,
        file.buffer,
        'image/webp',
      );
      expect(storage.delete).not.toHaveBeenCalled();
      expect(result.image).toBe(`projects/${current.id}.webp`);
      expect(result.url).toBe('https://example.test/url');
    });

    it('replace même extension → upload, pas de delete (clé identique)', async () => {
      const current = mkProject({
        id: '22222222-2222-2222-2222-222222222222',
        image: 'projects/22222222-2222-2222-2222-222222222222.webp',
      });
      db.limit.mockResolvedValueOnce([current]);
      db.where.mockResolvedValueOnce(undefined);
      await service.uploadImage(current.id, file);
      expect(storage.upload).toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('replace extension différente → upload, update DB, delete ancienne', async () => {
      const current = mkProject({
        id: '33333333-3333-3333-3333-333333333333',
        image: 'projects/33333333-3333-3333-3333-333333333333.jpg',
      });
      db.limit.mockResolvedValueOnce([current]);
      db.where.mockResolvedValueOnce(undefined);
      await service.uploadImage(current.id, file);
      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        `projects/${current.id}.webp`,
        file.buffer,
        'image/webp',
      );
      expect(storage.delete).toHaveBeenCalledWith(
        'portfolio-storage',
        'projects/33333333-3333-3333-3333-333333333333.jpg',
      );
    });
  });
});

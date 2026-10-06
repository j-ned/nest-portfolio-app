/* eslint-disable @typescript-eslint/unbound-method */
import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { StorageService } from '../storage/storage.service';
import { ImageOptimizer } from '../storage/image-optimizer.service';
import type { Project } from '../database/schema';
import { ProjectImagesService } from './project-images.service';
import type { ProjectImageResponse } from './project-gallery';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let module: TestingModule;
  let db: ReturnType<typeof createMockDb>;
  let storage: jest.Mocked<StorageService>;
  let gallery: jest.Mocked<Pick<ProjectImagesService, 'galleryOf' | 'keysOf'>>;

  const mkImage = (id: string): ProjectImageResponse => ({
    id,
    url: `/storage/portfolio-storage/project-images/${id}-12345678.avif`,
    alt: `Capture ${id}`,
    width: 1600,
    height: 1000,
    order: 0,
  });

  const mkProject = (overrides: Partial<Project> = {}): Project => ({
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Mon site',
    slug: 'mon-site',
    category: 'web',
    tags: [],
    description: 'Description',
    pitch: null,
    highlight: null,
    scope: null,
    image: '',
    techChoices: [],
    architectureDecisions: [],
    liveUrl: null,
    repoUrl: null,
    repoUrlFront: null,
    repoUrlBack: null,
    kind: 'demo',
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

    gallery = {
      galleryOf: jest.fn().mockResolvedValue(new Map()),
      keysOf: jest.fn().mockResolvedValue([]),
    };

    module = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storage },
        { provide: ProjectImagesService, useValue: gallery },
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
    service = module.get(ProjectsService);
  });

  describe('findAll', () => {
    it('retourne tous les projets transformés (image=URL ou ""), triés order ASC, createdAt DESC', async () => {
      const rows = [
        mkProject({ id: 'a', image: 'projects/a.webp' }),
        mkProject({ id: 'b', image: '' }),
      ];
      db.orderBy.mockResolvedValueOnce(rows);
      const result = await service.findAll({});
      expect(result).toHaveLength(2);
      expect(result[0].image).toBe('https://example.test/url');
      expect(result[1].image).toBe('');
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
    it('retourne le projet avec image transformée en URL', async () => {
      const row = mkProject({ image: 'projects/<id>.webp' });
      db.limit.mockResolvedValueOnce([row]);
      const result = await service.findById(row.id);
      expect(result.image).toBe('https://example.test/url');
    });

    it('retourne image: "" quand DB image est vide', async () => {
      const row = mkProject({ image: '' });
      db.limit.mockResolvedValueOnce([row]);
      const result = await service.findById(row.id);
      expect(result.image).toBe('');
    });

    it('throw NotFoundException si absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('insère avec slug auto-calculé depuis title et image transformée en URL', async () => {
      const created = mkProject({
        title: 'Mon site',
        slug: 'mon-site',
        image: 'projects/foo.webp',
      });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({
        title: 'Mon site',
        category: 'web',
        description: 'desc',
      });
      expect(result.slug).toBe('mon-site');
      expect(result.image).toBe('https://example.test/url');
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

    it('throw ConflictException quand Drizzle wrappe le PostgresError dans .cause', async () => {
      // Drizzle ≥0.36 wraps the raw pg error in a DrizzleQueryError whose
      // `.cause` holds the PostgresError (code '23505' + constraint_name).
      const wrappedErr = new Error('Failed query: INSERT INTO ...');
      (wrappedErr as unknown as Record<string, unknown>).cause = {
        code: '23505',
        constraint_name: 'project_slug_unique',
      };
      db.returning.mockRejectedValueOnce(wrappedErr);
      await expect(
        service.create({
          title: 'Mon site',
          category: 'web',
          description: 'desc',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("transmet techChoices/architectureDecisions à l'insert DB", async () => {
      const techChoices = [{ techno: 'NestJS', why: 'modulaire' }];
      const architectureDecisions = [
        { decision: 'hexagonale', rationale: 'testable' },
      ];
      db.returning.mockResolvedValueOnce([
        mkProject({ techChoices, architectureDecisions }),
      ]);

      const result = await service.create({
        title: 'Mon site',
        category: 'web',
        description: 'Desc',
        techChoices,
        architectureDecisions,
      });

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ techChoices, architectureDecisions }),
      );
      expect(result.techChoices).toEqual(techChoices);
      expect(result.architectureDecisions).toEqual(architectureDecisions);
    });
  });

  describe('gallery (ADR-0009)', () => {
    it('Given projects with and without captures, When listing, Then each one carries its own gallery', async () => {
      db.orderBy.mockResolvedValueOnce([
        mkProject({ id: 'a' }),
        mkProject({ id: 'b' }),
      ]);
      gallery.galleryOf.mockResolvedValueOnce(
        new Map([['a', [mkImage('x'), mkImage('y')]]]),
      );
      const result = await service.findAll({});
      expect(gallery.galleryOf).toHaveBeenCalledWith(['a', 'b']);
      expect(result[0].gallery.map((i) => i.id)).toEqual(['x', 'y']);
      expect(result[1].gallery).toEqual([]);
    });

    it('Given a project with captures, When read by id, Then its gallery is included', async () => {
      const row = mkProject();
      db.limit.mockResolvedValueOnce([row]);
      gallery.galleryOf.mockResolvedValueOnce(
        new Map([[row.id, [mkImage('x')]]]),
      );
      const result = await service.findById(row.id);
      expect(gallery.galleryOf).toHaveBeenCalledWith([row.id]);
      expect(result.gallery).toEqual([mkImage('x')]);
    });

    it('Given a new project, When created, Then its gallery is empty without a query', async () => {
      db.returning.mockResolvedValueOnce([mkProject()]);
      const result = await service.create({
        title: 'Mon site',
        category: 'web',
        description: 'd',
      });
      expect(result.gallery).toEqual([]);
      expect(gallery.galleryOf).not.toHaveBeenCalled();
    });

    it('Given a project with captures, When updated, Then the response keeps its gallery', async () => {
      const row = mkProject();
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([row]);
      gallery.galleryOf.mockResolvedValueOnce(
        new Map([[row.id, [mkImage('x')]]]),
      );
      const result = await service.update(row.id, { featured: true });
      expect(result.gallery).toEqual([mkImage('x')]);
    });

    it('Given a project with captures, When its cover is replaced, Then the response keeps its gallery', async () => {
      const row = mkProject();
      db.limit.mockResolvedValueOnce([row]);
      db.returning.mockResolvedValueOnce([row]);
      gallery.galleryOf.mockResolvedValueOnce(
        new Map([[row.id, [mkImage('x')]]]),
      );
      const result = await service.uploadImage(row.id, {
        buffer: Buffer.from('f'),
      } as Express.Multer.File);
      expect(result.gallery).toEqual([mkImage('x')]);
    });
  });

  describe('kind (ADR-0008)', () => {
    it('Given a kind, When creating, Then it is inserted and exposed', async () => {
      db.returning.mockResolvedValueOnce([mkProject({ kind: 'production' })]);
      const result = await service.create({
        title: 'Mon site',
        category: 'web',
        description: 'desc',
        kind: 'production',
      });
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'production' }),
      );
      expect(result.kind).toBe('production');
    });

    it('Given no kind, When creating, Then kind is left to the column default', async () => {
      db.returning.mockResolvedValueOnce([mkProject()]);
      await service.create({
        title: 'Mon site',
        category: 'web',
        description: 'd',
      });
      const [inserted] = db.values.mock.calls[0] as [Record<string, unknown>];
      expect(inserted).not.toHaveProperty('kind');
    });

    it('Given a kind, When updating, Then it is written and exposed', async () => {
      db.limit.mockResolvedValueOnce([mkProject()]);
      db.returning.mockResolvedValueOnce([mkProject({ kind: 'script' })]);
      const result = await service.update(mkProject().id, { kind: 'script' });
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'script' }),
      );
      expect(result.kind).toBe('script');
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
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('ne touche pas S3 si le write DB échoue (image: null)', async () => {
      const current = mkProject({ image: 'projects/some-id.webp' });
      db.limit.mockResolvedValueOnce([current]);
      db.returning.mockRejectedValueOnce({
        code: '23505',
        constraint_name: 'project_slug_unique',
      });
      await expect(
        service.update(current.id, { title: 'Collision', image: null }),
      ).rejects.toThrow(ConflictException);
      expect(storage.delete).not.toHaveBeenCalled();
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

    it('throw ConflictException quand Drizzle wrappe le PostgresError dans .cause (update)', async () => {
      const wrappedErr = new Error('Failed query: UPDATE ...');
      (wrappedErr as unknown as Record<string, unknown>).cause = {
        code: '23505',
        constraint_name: 'project_slug_unique',
      };
      db.limit.mockResolvedValueOnce([mkProject()]);
      db.returning.mockRejectedValueOnce(wrappedErr);
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

    it('supprime row DB puis image S3 si image présente', async () => {
      const current = mkProject({ image: 'projects/<id>.webp' });
      db.limit.mockResolvedValueOnce([current]);
      await service.remove(current.id);
      expect(storage.delete).toHaveBeenCalledWith(
        'portfolio-storage',
        'projects/<id>.webp',
      );
    });

    it('Given a project with a gallery, When removed, Then its capture keys are read before and deleted from S3 after the row', async () => {
      const current = mkProject({ image: 'projects/cover.avif' });
      const calls: string[] = [];
      db.limit.mockResolvedValueOnce([current]);
      gallery.keysOf.mockImplementationOnce(() => {
        calls.push('keysOf');
        return Promise.resolve([
          'project-images/a.avif',
          'project-images/b.avif',
        ]);
      });
      db.where.mockReturnValueOnce(db).mockImplementationOnce(() => {
        calls.push('db.delete');
        return Promise.resolve(undefined);
      });
      storage.delete.mockImplementation((_bucket, key) => {
        calls.push(`s3:${key}`);
        return Promise.resolve();
      });

      await service.remove(current.id);

      expect(calls).toEqual([
        'keysOf',
        'db.delete',
        's3:projects/cover.avif',
        's3:project-images/a.avif',
        's3:project-images/b.avif',
      ]);
    });

    it('Given one S3 delete fails after the row is gone, When removed, Then the other keys are still deleted, the failure is logged and no error reaches the client', async () => {
      const current = mkProject({ image: 'projects/cover.avif' });
      db.limit.mockResolvedValueOnce([current]);
      gallery.keysOf.mockResolvedValueOnce([
        'project-images/a.avif',
        'project-images/b.avif',
      ]);
      storage.delete.mockImplementation((_bucket, key) =>
        key === 'project-images/a.avif'
          ? Promise.reject(new Error('S3 down'))
          : Promise.resolve(),
      );
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(service.remove(current.id)).resolves.toBeUndefined();

      expect(storage.delete.mock.calls.map(([, key]) => key)).toEqual([
        'projects/cover.avif',
        'project-images/a.avif',
        'project-images/b.avif',
      ]);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(String(logError.mock.calls[0][0])).toContain(
        'project-images/a.avif',
      );
      logError.mockRestore();
    });

    it("ne touche pas S3 si pas d'image", async () => {
      const current = mkProject({ image: '' });
      db.limit.mockResolvedValueOnce([current]);
      await service.remove(current.id);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('ne touche pas S3 si le delete DB échoue', async () => {
      const current = mkProject({ image: 'projects/some-id.webp' });
      db.limit.mockResolvedValueOnce([current]);
      db.delete.mockImplementationOnce(() => {
        throw new Error('DB connection lost');
      });
      await expect(service.remove(current.id)).rejects.toThrow(
        'DB connection lost',
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('uploadImage', () => {
    const HASH = createHash('sha256')
      .update('avif-bytes')
      .digest('hex')
      .slice(0, 8);
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
      const updated = mkProject({
        ...current,
        image: `projects/${current.id}-${HASH}.avif`,
      });
      db.limit.mockResolvedValueOnce([current]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.uploadImage(current.id, file);
      // Quel que soit le fichier reçu, c'est la version optimisée (AVIF) qui part en S3.
      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        `projects/${current.id}-${HASH}.avif`,
        Buffer.from('avif-bytes'),
        'image/avif',
      );
      expect(storage.delete).not.toHaveBeenCalled();
      expect(result.image).toBe('https://example.test/url');
      expect(result.id).toBe(current.id);
    });

    it('même image renvoyée → même clé, upload mais pas de delete', async () => {
      const current = mkProject({
        id: '22222222-2222-2222-2222-222222222222',
        image: `projects/22222222-2222-2222-2222-222222222222-${HASH}.avif`,
      });
      const updated = mkProject({ ...current });
      db.limit.mockResolvedValueOnce([current]);
      db.returning.mockResolvedValueOnce([updated]);
      await service.uploadImage(current.id, file);
      expect(storage.upload).toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('replace extension différente → upload, update DB, delete ancienne', async () => {
      const current = mkProject({
        id: '33333333-3333-3333-3333-333333333333',
        image: 'projects/33333333-3333-3333-3333-333333333333.jpg',
      });
      const updated = mkProject({
        ...current,
        image: 'projects/33333333-3333-3333-3333-333333333333.avif',
      });
      db.limit.mockResolvedValueOnce([current]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.uploadImage(current.id, file);
      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        `projects/${current.id}-${HASH}.avif`,
        Buffer.from('avif-bytes'),
        'image/avif',
      );
      expect(storage.delete).toHaveBeenCalledWith(
        'portfolio-storage',
        'projects/33333333-3333-3333-3333-333333333333.jpg',
      );
      expect(result.image).toBe('https://example.test/url');
    });

    it("image illisible → 422 de l'optimiseur, rien n'est envoyé en S3", async () => {
      const current = mkProject({ image: '' });
      db.limit.mockResolvedValueOnce([current]);
      const optimizer = module.get<jest.Mocked<ImageOptimizer>>(ImageOptimizer);
      optimizer.optimize.mockRejectedValueOnce(
        new UnprocessableEntityException('Image illisible'),
      );
      await expect(service.uploadImage(current.id, file)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(storage.upload).not.toHaveBeenCalled();
    });
  });

  describe('editorial fields (ADR-0010)', () => {
    const EDITORIAL = {
      pitch: 'Le budget familial et le suivi médical de toute la famille.',
      highlight: 'Chiffrement de bout en bout côté client',
      scope: 'Conception, développement, déploiement',
    };

    it('Given a pitch, a highlight and a scope, When creating, Then they are inserted and exposed', async () => {
      db.returning.mockResolvedValueOnce([{ ...mkProject(), ...EDITORIAL }]);
      const result = await service.create({
        title: 'Mon site',
        category: 'web',
        description: 'desc',
        ...EDITORIAL,
      });
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining(EDITORIAL),
      );
      expect(result).toMatchObject(EDITORIAL);
    });

    it('Given none of them, When creating, Then the insert leaves them to the NULL columns', async () => {
      db.returning.mockResolvedValueOnce([mkProject()]);
      await service.create({
        title: 'Mon site',
        category: 'web',
        description: 'd',
      });
      const [inserted] = db.values.mock.calls[0] as [Record<string, unknown>];
      expect(inserted).not.toHaveProperty('pitch');
      expect(inserted).not.toHaveProperty('highlight');
      expect(inserted).not.toHaveProperty('scope');
    });

    it('Given stored values, When listing, Then every response carries the three keys', async () => {
      db.orderBy.mockResolvedValueOnce([
        { ...mkProject({ id: 'a' }), ...EDITORIAL },
        {
          ...mkProject({ id: 'b' }),
          pitch: null,
          highlight: null,
          scope: null,
        },
      ]);
      const [written, blank] = await service.findAll({});
      expect(written).toMatchObject(EDITORIAL);
      expect(blank).toMatchObject({
        pitch: null,
        highlight: null,
        scope: null,
      });
    });

    it('Given null on the three fields, When updating, Then null is written and exposed', async () => {
      const cleared = { pitch: null, highlight: null, scope: null };
      db.limit.mockResolvedValueOnce([{ ...mkProject(), ...EDITORIAL }]);
      db.returning.mockResolvedValueOnce([mkProject(cleared)]);
      const result = await service.update(mkProject().id, cleared);
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining(cleared));
      expect(result).toMatchObject(cleared);
    });

    it('Given a new pitch only, When updating, Then the highlight and the scope are left out of the SET', async () => {
      db.limit.mockResolvedValueOnce([{ ...mkProject(), ...EDITORIAL }]);
      db.returning.mockResolvedValueOnce([
        { ...mkProject(), ...EDITORIAL, pitch: 'Nouvelle accroche' },
      ]);
      const result = await service.update(mkProject().id, {
        pitch: 'Nouvelle accroche',
      });
      const [patch] = db.set.mock.calls[0] as [Record<string, unknown>];
      expect(patch).toMatchObject({ pitch: 'Nouvelle accroche' });
      expect(patch).not.toHaveProperty('highlight');
      expect(patch).not.toHaveProperty('scope');
      expect(result).toMatchObject({
        pitch: 'Nouvelle accroche',
        highlight: EDITORIAL.highlight,
        scope: EDITORIAL.scope,
      });
    });

    it('Given a stored project, When its cover is uploaded, Then the response keeps the three fields', async () => {
      db.limit.mockResolvedValueOnce([{ ...mkProject(), ...EDITORIAL }]);
      db.returning.mockResolvedValueOnce([{ ...mkProject(), ...EDITORIAL }]);
      const result = await service.uploadImage(mkProject().id, {
        buffer: Buffer.from('f'),
      } as Express.Multer.File);
      expect(result).toMatchObject(EDITORIAL);
    });
  });
});

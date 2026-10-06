import {
  FileTypeValidator,
  type INestApplication,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MulterModule } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { multerConfig } from '../common/multer.config';
import { ProjectImagesController } from './project-images.controller';
import { ProjectImagesService } from './project-images.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
// PNG 1×1 réel : FileTypeValidator vérifie les octets magiques, pas seulement le Content-Type.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Contrôleur monté avec la même ValidationPipe que main.ts ; service et JWT remplacés. */
describe('ProjectImagesController (HTTP)', () => {
  let app: INestApplication<App>;
  const images = {
    upload: jest.fn(),
    updateAlt: jest.fn(),
    remove: jest.fn(),
    reorder: jest.fn(),
  };

  beforeAll(async () => {
    // Sous Jest, FileTypeValidator ne peut pas charger le paquet ESM `file-type` (octets magiques)
    // et refuse tout. On garde sa règle sur le type MIME ; la détection par octets magiques est
    // vérifiée hors Jest (Node : un PDF annoncé image/png est refusé).
    jest
      .spyOn(FileTypeValidator.prototype, 'isValid')
      .mockImplementation(function (
        this: { validationOptions: { fileType: RegExp } },
        file?: { mimetype?: string },
      ) {
        return Promise.resolve(
          this.validationOptions.fileType.test(file?.mimetype ?? ''),
        );
      });
    const module = await Test.createTestingModule({
      imports: [MulterModule.register(multerConfig(5))],
      controllers: [ProjectImagesController],
      providers: [{ provide: ProjectImagesService, useValue: images }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });
  beforeEach(() => jest.clearAllMocks());

  it.each(['upload', 'updateAlt', 'remove', 'reorder'])(
    '%s is guarded by JwtAuthGuard',
    (name) => {
      const handler = Object.getOwnPropertyDescriptor(
        ProjectImagesController.prototype,
        name,
      )?.value as object;
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        JwtAuthGuard,
      );
    },
  );

  describe('POST /projects/:id/images', () => {
    const post = () =>
      request(app.getHttpServer()).post(`/projects/${PROJECT_ID}/images`);

    it('Given a PNG and an alt, When posted, Then 201 with the created capture', async () => {
      const created = {
        id: 'x',
        url: '/storage/portfolio-storage/project-images/x.avif',
        alt: 'Tableau de bord',
        width: 1600,
        height: 1000,
        order: 0,
      };
      images.upload.mockResolvedValueOnce(created);

      const res = await post()
        .field('alt', '  Tableau de bord ')
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(created);
      const [id, file, alt] = images.upload.mock.calls[0] as [
        string,
        Express.Multer.File,
        string,
      ];
      expect(id).toBe(PROJECT_ID);
      expect(file.buffer).toEqual(PNG);
      expect(alt).toBe('Tableau de bord');
    });

    it('Given a non-image file, When posted, Then 422 without calling the service', async () => {
      const res = await post()
        .field('alt', 'Alt')
        .attach('file', Buffer.from('%PDF'), {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(422);
      expect(images.upload).not.toHaveBeenCalled();
    });

    it('Given a file over 5 MB, When posted, Then 413 without calling the service', async () => {
      const res = await post()
        .field('alt', 'Alt')
        .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), {
          filename: 'big.png',
          contentType: 'image/png',
        });
      expect(res.status).toBe(413);
      expect(images.upload).not.toHaveBeenCalled();
    });

    it('Given no file, When posted, Then 422 without calling the service', async () => {
      const res = await post().field('alt', 'Alt');
      expect(res.status).toBe(422);
      expect(images.upload).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', undefined],
      ['blank', '   '],
      ['too long', 'a'.repeat(301)],
    ])(
      'Given an alt %s, When posted, Then 400 (global ValidationPipe) without calling the service',
      async (_, alt) => {
        const req = post();
        if (alt !== undefined) void req.field('alt', alt);
        const res = await req.attach('file', PNG, {
          filename: 'a.png',
          contentType: 'image/png',
        });
        expect(res.status).toBe(400);
        expect(images.upload).not.toHaveBeenCalled();
      },
    );

    it('Given a non-UUID project id, When posted, Then 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects/not-a-uuid/images')
        .field('alt', 'Alt')
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
      expect(images.upload).not.toHaveBeenCalled();
    });

    it('Given the gallery is full, When posted, Then the service 422 is returned', async () => {
      images.upload.mockRejectedValueOnce(
        new UnprocessableEntityException('Galerie pleine'),
      );
      const res = await post()
        .field('alt', 'Alt')
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
      expect(res.status).toBe(422);
    });
  });

  describe('PATCH /projects/:id/images/:imageId', () => {
    const IMAGE_ID = '22222222-2222-4222-8222-222222222222';

    it('Given a new alt, When patched, Then 200 with the capture', async () => {
      images.updateAlt.mockResolvedValueOnce({
        id: IMAGE_ID,
        alt: 'Nouvel alt',
      });
      const res = await request(app.getHttpServer())
        .patch(`/projects/${PROJECT_ID}/images/${IMAGE_ID}`)
        .send({ alt: ' Nouvel alt ' });
      expect(res.status).toBe(200);
      expect(images.updateAlt).toHaveBeenCalledWith(
        PROJECT_ID,
        IMAGE_ID,
        'Nouvel alt',
      );
    });

    it.each([
      ['blank alt', { alt: ' ' }],
      ['unknown field', { alt: 'Alt', order: 3 }],
    ])('Given a %s, When patched, Then 400', async (_, body) => {
      const res = await request(app.getHttpServer())
        .patch(`/projects/${PROJECT_ID}/images/${IMAGE_ID}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(images.updateAlt).not.toHaveBeenCalled();
    });

    it('Given a non-UUID image id, When patched, Then 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/projects/${PROJECT_ID}/images/nope`)
        .send({ alt: 'Alt' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /projects/:id/images/:imageId', () => {
    const IMAGE_ID = '22222222-2222-4222-8222-222222222222';

    it('Given a capture, When deleted, Then 204', async () => {
      images.remove.mockResolvedValueOnce(undefined);
      const res = await request(app.getHttpServer()).delete(
        `/projects/${PROJECT_ID}/images/${IMAGE_ID}`,
      );
      expect(res.status).toBe(204);
      expect(images.remove).toHaveBeenCalledWith(PROJECT_ID, IMAGE_ID);
    });

    it('Given a capture of another project, When deleted, Then the service 404 is returned', async () => {
      images.remove.mockRejectedValueOnce(new NotFoundException());
      const res = await request(app.getHttpServer()).delete(
        `/projects/${PROJECT_ID}/images/${IMAGE_ID}`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /projects/:id/images/order', () => {
    const A = '22222222-2222-4222-8222-222222222222';
    const B = '33333333-3333-4333-8333-333333333333';

    it('Given the full list of ids, When put, Then 200 with the reordered gallery', async () => {
      const gallery = [
        { id: B, order: 0 },
        { id: A, order: 1 },
      ];
      images.reorder.mockResolvedValueOnce(gallery);
      const res = await request(app.getHttpServer())
        .put(`/projects/${PROJECT_ID}/images/order`)
        .send({ imageIds: [B, A] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(gallery);
      expect(images.reorder).toHaveBeenCalledWith(PROJECT_ID, [B, A]);
    });

    it.each([
      ['no imageIds', {}],
      ['a non-UUID id', { imageIds: [A, 'nope'] }],
      ['a duplicate id', { imageIds: [A, A] }],
    ])(
      'Given %s, When put, Then 400 without calling the service',
      async (_, body) => {
        const res = await request(app.getHttpServer())
          .put(`/projects/${PROJECT_ID}/images/order`)
          .send(body);
        expect(res.status).toBe(400);
        expect(images.reorder).not.toHaveBeenCalled();
      },
    );

    it('Given a list that is not a permutation, When put, Then the service 422 is returned', async () => {
      images.reorder.mockRejectedValueOnce(new UnprocessableEntityException());
      const res = await request(app.getHttpServer())
        .put(`/projects/${PROJECT_ID}/images/order`)
        .send({ imageIds: [A] });
      expect(res.status).toBe(422);
    });
  });
});

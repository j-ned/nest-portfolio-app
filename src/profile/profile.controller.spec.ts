import 'reflect-metadata';
import {
  ConflictException,
  FileTypeValidator,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
// Les constantes de clés ne sont pas ré-exportées par l'index du paquet.
import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { multerConfig } from '../common/multer.config';
import { PUBLIC_READ_THROTTLE } from '../common/throttle';
import { ProfileController } from './profile.controller';
import { ProfilePortraitService } from './profile-portrait.service';
import { ProfileService } from './profile.service';
import { aProfileContent } from './profile-test-builders';

const handler = (name: keyof ProfileController): object =>
  Object.getOwnPropertyDescriptor(ProfileController.prototype, name)
    ?.value as object;

/** Contrôleur monté avec la même ValidationPipe que main.ts ; services et JWT remplacés. */
describe('ProfileController (HTTP)', () => {
  let app: INestApplication<App>;
  const profile = { findCurrent: jest.fn(), replace: jest.fn() };
  const portrait = { replace: jest.fn(), remove: jest.fn() };

  beforeAll(async () => {
    // Sous Jest, FileTypeValidator ne peut pas charger le paquet ESM `file-type` (octets magiques) :
    // même contournement que ProjectImagesController, on garde sa règle sur le type MIME.
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
      controllers: [ProfileController],
      providers: [
        { provide: ProfileService, useValue: profile },
        { provide: ProfilePortraitService, useValue: portrait },
      ],
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

  describe('GET /profile', () => {
    it('is public: no guard', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, handler('findCurrent')),
      ).toBeUndefined();
    });

    it('allows the public read rate (prerender of the site)', () => {
      expect(
        Reflect.getMetadata(
          `${THROTTLER_LIMIT}default`,
          handler('findCurrent'),
        ),
      ).toBe(PUBLIC_READ_THROTTLE.default.limit);
    });

    it('Given the document, When requested, Then 200 with the document', async () => {
      profile.findCurrent.mockResolvedValueOnce({
        version: 1,
        portrait: null,
      });

      const res = await request(app.getHttpServer()).get('/profile');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ version: 1, portrait: null });
    });
  });

  describe('PUT /profile', () => {
    const put = () => request(app.getHttpServer()).put('/profile');
    const body = { ...aProfileContent(), version: 2 };

    it('is guarded by JwtAuthGuard', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, handler('replace')),
      ).toContain(JwtAuthGuard);
    });

    it('Given a valid document, When sent, Then the service replaces it and 200 returns its answer', async () => {
      profile.replace.mockResolvedValueOnce({ version: 3 });

      const res = await put().send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ version: 3 });
      expect(profile.replace).toHaveBeenCalledWith(
        expect.objectContaining({ version: 2, workSummary: body.workSummary }),
      );
    });

    it('Given an unknown key, When sent, Then 400 and the service is not called', async () => {
      const res = await put().send({ ...body, updatedAt: '2026-10-11' });

      expect(res.status).toBe(400);
      expect(profile.replace).not.toHaveBeenCalled();
    });

    it('Given a stale version, When sent, Then 409', async () => {
      profile.replace.mockRejectedValueOnce(
        new ConflictException('version périmée'),
      );

      const res = await put().send(body);

      expect(res.status).toBe(409);
    });
  });

  describe('POST /profile/portrait', () => {
    // PNG 1×1 réel.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const post = () => request(app.getHttpServer()).post('/profile/portrait');

    it('is guarded by JwtAuthGuard', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, handler('uploadPortrait')),
      ).toContain(JwtAuthGuard);
    });

    it.each([
      ['image/png', 'portrait.png'],
      ['image/jpeg', 'portrait.jpg'],
      ['image/webp', 'portrait.webp'],
      ['image/avif', 'portrait.avif'],
    ])(
      'Given a %s file, When sent, Then 200 with the document from the service',
      async (contentType, filename) => {
        portrait.replace.mockResolvedValueOnce({ portrait: '/storage/x.avif' });

        const res = await post().attach('file', PNG, { filename, contentType });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ portrait: '/storage/x.avif' });
        expect(portrait.replace).toHaveBeenCalledWith(
          expect.objectContaining({ mimetype: contentType }),
        );
      },
    );

    it.each([
      ['a PDF', 'application/pdf', 'cv.pdf'],
      ['an SVG', 'image/svg+xml', 'logo.svg'],
    ])(
      'Given %s, When sent, Then 422 and the service is not called',
      async (_label, contentType, filename) => {
        const res = await post().attach('file', PNG, { filename, contentType });

        expect(res.status).toBe(422);
        expect(portrait.replace).not.toHaveBeenCalled();
      },
    );

    it('Given no file, When sent, Then 422', async () => {
      const res = await post();

      expect(res.status).toBe(422);
      expect(portrait.replace).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /profile/portrait', () => {
    it('is guarded by JwtAuthGuard', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, handler('removePortrait')),
      ).toContain(JwtAuthGuard);
    });

    it('When sent, Then the service removes the portrait and 204', async () => {
      portrait.remove.mockResolvedValueOnce(undefined);

      const res = await request(app.getHttpServer()).delete(
        '/profile/portrait',
      );

      expect(res.status).toBe(204);
      expect(portrait.remove).toHaveBeenCalledTimes(1);
    });
  });
});

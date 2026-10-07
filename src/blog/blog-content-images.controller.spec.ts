import {
  FileTypeValidator,
  type INestApplication,
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
import { BlogContentImagesController } from './blog-content-images.controller';
import { BlogContentImagesService } from './blog-content-images.service';

// PNG 1×1 réel : FileTypeValidator vérifie les octets magiques, pas seulement le Content-Type.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Contrôleur monté avec la même ValidationPipe que main.ts ; service et JWT remplacés. */
describe('BlogContentImagesController (HTTP)', () => {
  let app: INestApplication<App>;
  const images = { upload: jest.fn() };

  beforeAll(async () => {
    // Même contournement que ProjectImagesController : sous Jest, le paquet ESM `file-type`
    // n'est pas chargeable, on garde la règle sur le type MIME.
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
      controllers: [BlogContentImagesController],
      providers: [{ provide: BlogContentImagesService, useValue: images }],
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

  const post = () => request(app.getHttpServer()).post('/blog/content-images');

  it('upload is guarded by JwtAuthGuard', () => {
    const handler = Object.getOwnPropertyDescriptor(
      BlogContentImagesController.prototype,
      'upload',
    )?.value as object;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
      JwtAuthGuard,
    );
  });

  it.each([
    ['image/png', 'a.png'],
    ['image/jpeg', 'a.jpg'],
    ['image/webp', 'a.webp'],
    ['image/avif', 'a.avif'],
  ])(
    'Given a %s file, When posted, Then 201 with the url and dimensions',
    async (contentType, filename) => {
      const created = {
        url: '/storage/portfolio-storage/blog-content/x-a1b2c3d4-1600x900.avif',
        width: 1600,
        height: 900,
      };
      images.upload.mockResolvedValueOnce(created);

      const res = await post().attach('file', PNG, { filename, contentType });

      expect(res.status).toBe(201);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toEqual(created);
      const [file] = images.upload.mock.calls[0] as [Express.Multer.File];
      expect(file.buffer).toEqual(PNG);
    },
  );

  it.each([
    ['application/pdf', 'a.pdf'],
    ['image/gif', 'a.gif'],
    ['image/svg+xml', 'a.svg'],
  ])(
    'Given a %s file, When posted, Then 422 without calling the service',
    async (contentType, filename) => {
      const res = await post().attach('file', Buffer.from('%PDF'), {
        filename,
        contentType,
      });
      expect(res.status).toBe(422);
      expect(images.upload).not.toHaveBeenCalled();
    },
  );

  it('Given no file, When posted, Then 422 without calling the service', async () => {
    const res = await post();
    expect(res.status).toBe(422);
    expect(images.upload).not.toHaveBeenCalled();
  });

  it('Given a file over 5 MB, When posted, Then 413 without calling the service', async () => {
    const res = await post().attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), {
      filename: 'big.png',
      contentType: 'image/png',
    });
    expect(res.status).toBe(413);
    expect(images.upload).not.toHaveBeenCalled();
  });

  it('Given an unreadable image, When posted, Then the optimizer 422 is returned', async () => {
    images.upload.mockRejectedValueOnce(
      new UnprocessableEntityException('Image illisible'),
    );
    const res = await post().attach('file', PNG, {
      filename: 'a.png',
      contentType: 'image/png',
    });
    expect(res.status).toBe(422);
  });
});

import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
// Les constantes de clés ne sont pas ré-exportées par l'index du paquet.
import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PUBLIC_READ_THROTTLE } from '../common/throttle';
import { WorkshopGuideController } from './workshop-guide.controller';
import { WorkshopGuideService } from './workshop-guide.service';
import {
  anAllMaterialsEntry,
  aWorkshopGuideContent,
  withoutDecoderToggle,
} from './workshop-guide-test-builders';

const handler = (name: keyof WorkshopGuideController): object =>
  Object.getOwnPropertyDescriptor(WorkshopGuideController.prototype, name)
    ?.value as object;

/** Contrôleur monté avec la même ValidationPipe que app.setup.ts ; service et JWT remplacés. */
describe('WorkshopGuideController (HTTP)', () => {
  let app: INestApplication<App>;
  const guide = { findCurrent: jest.fn(), replace: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkshopGuideController],
      providers: [{ provide: WorkshopGuideService, useValue: guide }],
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

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('is served under /workshop-guide', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WorkshopGuideController)).toBe(
      'workshop-guide',
    );
  });

  describe('GET /workshop-guide', () => {
    it('is public: no guard', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, handler('findCurrent')),
      ).toBeUndefined();
    });

    it('allows the public read rate (pages rendered on request)', () => {
      expect(
        Reflect.getMetadata(
          `${THROTTLER_LIMIT}default`,
          handler('findCurrent'),
        ),
      ).toBe(PUBLIC_READ_THROTTLE.default.limit);
    });

    it('Given the document, When requested, Then 200 with the document', async () => {
      guide.findCurrent.mockResolvedValueOnce({
        enabled: false,
        decoderEnabled: false,
        entries: [],
        version: 0,
        updatedAt: null,
      });

      const res = await request(app.getHttpServer()).get('/workshop-guide');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        enabled: false,
        decoderEnabled: false,
        entries: [],
        version: 0,
        updatedAt: null,
      });
    });
  });

  describe('PUT /workshop-guide', () => {
    const put = () => request(app.getHttpServer()).put('/workshop-guide');
    const body = { ...aWorkshopGuideContent(), version: 2 };

    it('is guarded by JwtAuthGuard', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, handler('replace')),
      ).toContain(JwtAuthGuard);
    });

    it('Given a valid document, When sent, Then the service replaces it and 200 returns its answer', async () => {
      guide.replace.mockResolvedValueOnce({ version: 3 });

      const res = await put().send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ version: 3 });
      expect(guide.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 2,
          enabled: true,
          decoderEnabled: true,
        }),
      );
    });

    it('Given a document without decoderEnabled (admin before spec 036), When sent, Then 200 and decoderEnabled stays undefined', async () => {
      guide.replace.mockResolvedValueOnce({ version: 3 });

      const res = await put().send({
        ...withoutDecoderToggle(body),
        version: body.version,
      });

      expect(res.status).toBe(200);
      const [[dto]] = guide.replace.mock.calls as [
        [{ decoderEnabled?: unknown }],
      ];
      expect(dto.decoderEnabled).toBeUndefined();
    });

    it.each([
      [
        'an all-materials boring entry without radius',
        {
          ...body,
          entries: [
            { ...anAllMaterialsEntry(), operation: 'boring', material: '' },
          ],
        },
      ],
      [
        'an entry with a null radius',
        { ...body, entries: [{ ...body.entries[0], noseRadius: null }] },
      ],
    ])(
      'Given %s (spec 037), When sent, Then 200 and the service is called',
      async (_l, sent) => {
        guide.replace.mockResolvedValueOnce({ version: 3 });

        const res = await put().send(sent);

        expect(res.status).toBe(200);
        expect(guide.replace).toHaveBeenCalled();
      },
    );

    it.each([
      [
        'an entry without material nor allMaterials',
        {
          ...body,
          entries: [{ ...body.entries[0], material: undefined }],
        },
      ],
      [
        'a radius at 0',
        { ...body, entries: [{ ...body.entries[0], noseRadius: 0 }] },
      ],
      ['an unknown key', { ...body, updatedAt: '2026-10-27' }],
      [
        'an operation outside the closed list',
        {
          ...body,
          entries: [{ ...body.entries[0], operation: 'milling' }],
        },
      ],
      ['enabled as a string', { ...body, enabled: 'false' }],
      ['decoderEnabled as a string', { ...body, decoderEnabled: 'false' }],
    ])(
      'Given %s, When sent, Then 400 and the service is not called',
      async (_l, sent) => {
        const res = await put().send(sent);

        expect(res.status).toBe(400);
        expect(guide.replace).not.toHaveBeenCalled();
      },
    );
  });
});

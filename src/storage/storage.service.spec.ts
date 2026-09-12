import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'node:stream';
import { StorageService } from './storage.service';
import { S3_CLIENT } from './s3.constants';

describe('StorageService', () => {
  let service: StorageService;
  const s3Mock = mockClient(S3Client);
  const realClient = new S3Client({ region: 'us-east-1' });

  beforeEach(async () => {
    s3Mock.reset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorageService, { provide: S3_CLIENT, useValue: realClient }],
    }).compile();
    service = module.get(StorageService);
  });

  describe('upload', () => {
    it('envoie un PutObjectCommand avec les bons paramètres', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      const body = Buffer.from('hello world');
      await service.upload(
        'my-bucket',
        'projects/foo.webp',
        body,
        'image/webp',
      );
      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toEqual({
        Bucket: 'my-bucket',
        Key: 'projects/foo.webp',
        Body: body,
        ContentType: 'image/webp',
      });
    });
  });

  describe('get', () => {
    const collectStream = (s: Readable): Promise<string> =>
      new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        s.on('data', (c: Buffer) => chunks.push(c));
        s.on('end', () => resolve(Buffer.concat(chunks).toString()));
        s.on('error', reject);
      });

    it('retourne { stream, contentType, contentLength } depuis la réponse S3', async () => {
      const stream = sdkStreamMixin(Readable.from(Buffer.from('content')));
      s3Mock.on(GetObjectCommand).resolves({
        Body: stream as never,
        ContentType: 'image/webp',
        ContentLength: 7,
      });
      const result = await service.get('my-bucket', 'foo.txt');
      expect(await collectStream(result.stream)).toBe('content');
      expect(result.contentType).toBe('image/webp');
      expect(result.contentLength).toBe(7);
    });

    it('contentType fallback à application/octet-stream si absent', async () => {
      const stream = sdkStreamMixin(Readable.from(Buffer.from('x')));
      s3Mock.on(GetObjectCommand).resolves({ Body: stream as never });
      const result = await service.get('my-bucket', 'foo.txt');
      expect(result.contentType).toBe('application/octet-stream');
      expect(result.contentLength).toBe(0);
    });

    it('throw NotFoundException si NoSuchKey', async () => {
      s3Mock
        .on(GetObjectCommand)
        .rejects(new NoSuchKey({ message: 'not found', $metadata: {} }));
      await expect(service.get('my-bucket', 'missing.txt')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rethrow toute autre erreur', async () => {
      s3Mock.on(GetObjectCommand).rejects(new Error('network down'));
      await expect(service.get('my-bucket', 'foo.txt')).rejects.toThrow(
        'network down',
      );
    });
  });

  describe('delete', () => {
    it("efface l'objet et sa carte de partage dérivée (idempotent)", async () => {
      s3Mock.on(DeleteObjectCommand).resolves({});
      await service.delete('my-bucket', 'foo.txt');
      const keys = s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((c) => c.args[0].input.Key);
      expect(keys).toEqual(['foo.txt', 'foo.txt.share.jpg']);
    });
  });

  describe('carte de partage dérivée (<key>.share.jpg)', () => {
    it("un nouvel upload de l'original jette la carte obsolète", async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      s3Mock.on(DeleteObjectCommand).resolves({});
      await service.upload('b', 'blog/1.avif', Buffer.from('x'), 'image/avif');
      const deleted = s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((c) => c.args[0].input.Key);
      expect(deleted).toEqual(['blog/1.avif.share.jpg']);
    });

    it("l'upload de la carte elle-même ne cascade pas", async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      await service.upload(
        'b',
        'blog/1.avif.share.jpg',
        Buffer.from('x'),
        'image/jpeg',
      );
      expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    });
  });

  describe('getPublicUrl', () => {
    it('retourne un chemin relatif /storage/{bucket}/{key} (proxy NestJS)', () => {
      expect(service.getPublicUrl('my-bucket', 'projects/foo.webp')).toBe(
        '/storage/my-bucket/projects/foo.webp',
      );
    });

    it("préserve les slashes dans la key (pas d'encodage)", () => {
      const url = service.getPublicUrl(
        'portfolio-storage',
        'avatar/avatar.webp',
      );
      expect(url).toBe('/storage/portfolio-storage/avatar/avatar.webp');
    });
  });
});

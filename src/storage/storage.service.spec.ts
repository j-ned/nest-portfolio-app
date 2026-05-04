import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'node:stream';
import { StorageService } from './storage.service';
import { S3_CLIENT } from './s3.constants';
import { AppConfigService } from '../config/app-config.service';

describe('StorageService', () => {
  let service: StorageService;
  const s3Mock = mockClient(S3Client);
  const realClient = new S3Client({ region: 'us-east-1' });

  beforeEach(async () => {
    s3Mock.reset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: S3_CLIENT, useValue: realClient },
        {
          provide: AppConfigService,
          useValue: { s3PublicUrl: 'https://cdn.example.com' },
        },
      ],
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
    it('retourne { buffer, contentType } depuis la réponse S3', async () => {
      const stream = sdkStreamMixin(Readable.from(Buffer.from('content')));
      s3Mock
        .on(GetObjectCommand)
        .resolves({ Body: stream as never, ContentType: 'image/webp' });
      const result = await service.get('my-bucket', 'foo.txt');
      expect(result.buffer.toString()).toBe('content');
      expect(result.contentType).toBe('image/webp');
    });

    it('contentType fallback à application/octet-stream si absent', async () => {
      const stream = sdkStreamMixin(Readable.from(Buffer.from('x')));
      s3Mock.on(GetObjectCommand).resolves({ Body: stream as never });
      const result = await service.get('my-bucket', 'foo.txt');
      expect(result.contentType).toBe('application/octet-stream');
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
    it('envoie un DeleteObjectCommand (idempotent)', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({});
      await service.delete('my-bucket', 'foo.txt');
      expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('retourne un tableau de S3Object', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          {
            Key: 'projects/a.webp',
            Size: 1234,
            LastModified: new Date('2026-01-01'),
          },
          {
            Key: 'projects/b.webp',
            Size: 5678,
            LastModified: new Date('2026-02-01'),
          },
        ],
      });
      const result = await service.list('my-bucket', 'projects/');
      expect(result).toEqual([
        {
          key: 'projects/a.webp',
          size: 1234,
          lastModified: new Date('2026-01-01'),
        },
        {
          key: 'projects/b.webp',
          size: 5678,
          lastModified: new Date('2026-02-01'),
        },
      ]);
    });

    it('retourne tableau vide si pas de Contents', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({});
      await expect(service.list('my-bucket')).resolves.toEqual([]);
    });
  });

  describe('getPublicUrl', () => {
    it('retourne un chemin relatif /storage/{bucket}/{key} (proxy NestJS)', () => {
      expect(service.getPublicUrl('my-bucket', 'projects/foo.webp')).toBe(
        '/storage/my-bucket/projects/foo.webp',
      );
    });

    it('préserve les slashes dans la key (pas d’encodage)', () => {
      const url = service.getPublicUrl(
        'portfolio-storage',
        'avatar/avatar.webp',
      );
      expect(url).toBe('/storage/portfolio-storage/avatar/avatar.webp');
    });

    it('ignore la config s3PublicUrl/s3Endpoint (proxy géré par le controller)', () => {
      const cfgFallback = {
        s3PublicUrl: undefined,
        s3Endpoint: 'http://localhost:9000',
      } as AppConfigService;
      const localService = new StorageService(realClient, cfgFallback);
      expect(localService.getPublicUrl('b', 'k')).toBe('/storage/b/k');
    });
  });
});

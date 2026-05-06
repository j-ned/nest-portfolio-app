import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { AppConfigService } from '../config/app-config.service';
import { S3_CLIENT } from './s3.constants';
import type { S3Object } from './storage.types';

export interface S3ObjectStream {
  stream: Readable;
  contentType: string;
  contentLength: number;
}

@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly cfg: AppConfigService,
  ) {}

  async upload(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(bucket: string, key: string): Promise<S3ObjectStream> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!res.Body) {
        throw new NotFoundException(
          `S3 object ${bucket}/${key} has empty body`,
        );
      }
      return {
        stream: res.Body as Readable,
        contentType: res.ContentType ?? 'application/octet-stream',
        contentLength: res.ContentLength ?? 0,
      };
    } catch (err: unknown) {
      if (err instanceof NoSuchKey) {
        throw new NotFoundException(`S3 object ${bucket}/${key} not found`);
      }
      throw err;
    }
  }

  async delete(bucket: string, key: string): Promise<void> {
    // S3 DeleteObject est idempotent : pas d'erreur si la clé n'existe pas.
    await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async list(bucket: string, prefix?: string): Promise<S3Object[]> {
    const res = await this.s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
    );
    return (res.Contents ?? []).map((o) => ({
      key: o.Key!,
      size: o.Size ?? 0,
      lastModified: o.LastModified ?? new Date(0),
    }));
  }

  /**
   * Retourne une URL publique servie par NestJS (proxy S3 via StorageController).
   * Format: `/storage/{bucket}/{key}` — chemin relatif au préfixe `/api` global.
   * Le frontend résout vers `${apiUrl}${path}` côté Angular.
   *
   * Pourquoi un proxy plutôt que l'URL S3 directe ? Garage v2 ne supporte pas
   * l'accès anonyme via l'API S3 (« Garage does not support anonymous access yet »),
   * donc les URLs `https://garage-s3.../bucket/key` retournent 403 depuis le browser.
   * Le proxy NestJS détient les credentials et stream l'objet.
   */
  getPublicUrl(bucket: string, key: string): string {
    return `/storage/${bucket}/${key}`;
  }
}

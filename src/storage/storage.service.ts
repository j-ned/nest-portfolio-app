import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { AppConfigService } from '../config/app-config.service';
import { S3_CLIENT } from './s3.constants';
import type { S3Object } from './storage.types';

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

  async get(bucket: string, key: string): Promise<Buffer> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!res.Body) {
        throw new NotFoundException(
          `S3 object ${bucket}/${key} has empty body`,
        );
      }
      return Buffer.from(await res.Body.transformToByteArray());
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

  getPublicUrl(bucket: string, key: string): string {
    const base = (this.cfg.s3PublicUrl ?? this.cfg.s3Endpoint ?? '').replace(
      /\/$/,
      '',
    );
    return `${base}/${bucket}/${encodeURIComponent(key)}`;
  }
}

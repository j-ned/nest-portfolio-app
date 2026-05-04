import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { S3_CLIENT } from './s3.constants';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

const s3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [AppConfigService],
  useFactory: (cfg: AppConfigService): S3Client =>
    new S3Client({
      endpoint: cfg.s3Endpoint,
      region: cfg.s3Region,
      credentials: {
        accessKeyId: cfg.s3AccessKey,
        secretAccessKey: cfg.s3SecretKey,
      },
      forcePathStyle: true, // requis pour MinIO et Garage
    }),
};

@Global()
@Module({
  imports: [AppConfigModule],
  controllers: [StorageController],
  providers: [s3ClientProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule implements OnModuleDestroy {
  constructor(@Inject(S3_CLIENT) private readonly s3: S3Client) {}

  onModuleDestroy(): void {
    this.s3.destroy();
  }
}

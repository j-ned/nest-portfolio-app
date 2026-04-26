import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { CvController } from './cv.controller';
import { CvService } from './cv.service';

@Module({
  imports: [
    AuthModule,
    MulterModule.register({
      // 10MB filet de sécurité ; validation fine via ParseFilePipe au niveau du paramètre
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  ],
  controllers: [CvController],
  providers: [CvService],
})
export class CvModule {}

import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { multerConfig } from '../common/multer.config';
import { CvController } from './cv.controller';
import { CvService } from './cv.service';

@Module({
  imports: [AuthModule, MulterModule.register(multerConfig(10))],
  controllers: [CvController],
  providers: [CvService],
})
export class CvModule {}

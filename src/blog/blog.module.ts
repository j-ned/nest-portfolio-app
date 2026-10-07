import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfigModule } from '../config/app-config.module';
import { AuthModule } from '../auth/auth.module';
import { multerConfig } from '../common/multer.config';
import { BlogContentImagesController } from './blog-content-images.controller';
import { BlogContentImagesService } from './blog-content-images.service';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

@Module({
  imports: [
    AuthModule,
    AppConfigModule,
    MulterModule.register(multerConfig(5)),
  ],
  controllers: [BlogController, BlogContentImagesController],
  providers: [BlogService, BlogContentImagesService],
})
export class BlogModule {}

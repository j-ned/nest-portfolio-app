import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { multerConfig } from '../common/multer.config';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

@Module({
  imports: [AuthModule, MulterModule.register(multerConfig(5))],
  controllers: [BlogController],
  providers: [BlogService],
})
export class BlogModule {}

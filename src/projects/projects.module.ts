import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { multerConfig } from '../common/multer.config';
import { ProjectsController } from './projects.controller';
import { ProjectImagesController } from './project-images.controller';
import { ProjectsService } from './projects.service';
import { ProjectImagesService } from './project-images.service';

@Module({
  imports: [AuthModule, MulterModule.register(multerConfig(5))],
  controllers: [ProjectsController, ProjectImagesController],
  providers: [ProjectsService, ProjectImagesService],
})
export class ProjectsModule {}

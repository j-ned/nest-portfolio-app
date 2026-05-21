import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { multerConfig } from '../common/multer.config';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule, MulterModule.register(multerConfig(5))],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}

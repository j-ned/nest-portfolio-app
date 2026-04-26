import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    AuthModule,
    MulterModule.register({
      // Mémoire (memoryStorage par défaut) : on garde le buffer pour upload S3 direct.
      // Filet de sécurité supplémentaire — la validation fine est dans ParseFilePipe.
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}

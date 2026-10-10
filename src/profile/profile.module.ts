import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { multerConfig } from '../common/multer.config';
import { AuthModule } from '../auth/auth.module';
import { ProfileController } from './profile.controller';
import { ProfilePortraitService } from './profile-portrait.service';
import { ProfileService } from './profile.service';

@Module({
  imports: [AuthModule, MulterModule.register(multerConfig(5))],
  controllers: [ProfileController],
  providers: [ProfileService, ProfilePortraitService],
})
export class ProfileModule {}

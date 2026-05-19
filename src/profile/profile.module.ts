import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { multerConfig } from '../common/multer.config';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [AuthModule, MulterModule.register(multerConfig(5))],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}

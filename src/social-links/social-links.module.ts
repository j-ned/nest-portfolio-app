import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SocialLinksController } from './social-links.controller';
import { SocialLinksService } from './social-links.service';

@Module({
  imports: [AuthModule],
  controllers: [SocialLinksController],
  providers: [SocialLinksService],
})
export class SocialLinksModule {}

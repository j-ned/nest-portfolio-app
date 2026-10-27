import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkshopGuideController } from './workshop-guide.controller';
import { WorkshopGuideService } from './workshop-guide.service';

@Module({
  imports: [AuthModule],
  controllers: [WorkshopGuideController],
  providers: [WorkshopGuideService],
})
export class WorkshopGuideModule {}

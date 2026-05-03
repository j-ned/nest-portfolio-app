import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BiographyController } from './biography.controller';
import { BiographyService } from './biography.service';

@Module({
  imports: [AuthModule],
  controllers: [BiographyController],
  providers: [BiographyService],
})
export class BiographyModule {}

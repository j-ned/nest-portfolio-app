import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ExpertisesController } from './expertises.controller';
import { ExpertisesService } from './expertises.service';

@Module({
  imports: [AuthModule],
  controllers: [ExpertisesController],
  providers: [ExpertisesService],
})
export class ExpertisesModule {}

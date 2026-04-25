import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DiplomasController } from './diplomas.controller';
import { DiplomasService } from './diplomas.service';

@Module({
  imports: [AuthModule],
  controllers: [DiplomasController],
  providers: [DiplomasService],
})
export class DiplomasModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HeroController } from './hero.controller';
import { HeroService } from './hero.service';

@Module({
  imports: [AuthModule],
  controllers: [HeroController],
  providers: [HeroService],
})
export class HeroModule {}

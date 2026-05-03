import { Module } from '@nestjs/common';
import { HeroModule } from '../hero/hero.module';
import { HighlightsModule } from '../highlights/highlights.module';
import { ServicePricingModule } from '../service-pricing/service-pricing.module';
import { ProjectsModule } from '../projects/projects.module';
import { HomeBundleController } from './home-bundle.controller';
import { HomeBundleService } from './home-bundle.service';

@Module({
  imports: [HeroModule, HighlightsModule, ServicePricingModule, ProjectsModule],
  controllers: [HomeBundleController],
  providers: [HomeBundleService],
})
export class HomeBundleModule {}

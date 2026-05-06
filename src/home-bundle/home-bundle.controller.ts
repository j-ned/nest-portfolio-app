import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HeroService } from '../hero/hero.service';
import { HighlightsService } from '../highlights/highlights.service';
import { ServicePricingService } from '../service-pricing/service-pricing.service';
import { ProjectsService } from '../projects/projects.service';

@ApiTags('HomeBundle')
@Controller('home-bundle')
export class HomeBundleController {
  constructor(
    private readonly hero: HeroService,
    private readonly highlights: HighlightsService,
    private readonly servicePricing: ServicePricingService,
    private readonly projects: ProjectsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({
    summary:
      'Aggregate landing page data (hero + home-highlights + services + featured projects)',
  })
  @ApiResponse({ status: 200, description: 'Aggregated home bundle' })
  async getBundle() {
    const [hero, highlights, services, featuredProjects] = await Promise.all([
      this.hero.findOne().catch(() => null),
      this.highlights.findAll('home'),
      this.servicePricing.findAll(),
      this.projects.findAll({ featured: true }),
    ]);
    return { hero, highlights, services, featuredProjects };
  }
}

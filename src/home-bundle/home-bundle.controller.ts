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
  // `no-cache` forces the browser/CDN to revalidate with the auto-generated
  // ETag before serving. A match returns 304 (cheap, no body) so we keep the
  // perf win without serving stale data after an admin edit.
  @Header('Cache-Control', 'public, no-cache')
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

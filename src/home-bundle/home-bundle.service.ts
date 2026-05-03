import { Injectable } from '@nestjs/common';
import { HeroService } from '../hero/hero.service';
import { HighlightsService } from '../highlights/highlights.service';
import { ServicePricingService } from '../service-pricing/service-pricing.service';
import { ProjectsService } from '../projects/projects.service';
import type { Hero } from '../database/schema';
import type { Highlight } from '../database/schema';
import type { ServicePricing } from '../database/schema';
import type { Project } from '../database/schema';

export type HomeBundleResponse = {
  hero: Hero | null;
  highlights: Highlight[];
  services: ServicePricing[];
  featuredProjects: Project[];
};

@Injectable()
export class HomeBundleService {
  constructor(
    private readonly hero: HeroService,
    private readonly highlights: HighlightsService,
    private readonly servicePricing: ServicePricingService,
    private readonly projects: ProjectsService,
  ) {}

  async getBundle(): Promise<HomeBundleResponse> {
    const [heroRes, highlights, services, featuredProjects] = await Promise.all(
      [
        this.hero.findOne().catch(() => null),
        this.highlights.findAll('home'),
        this.servicePricing.findAll(),
        this.projects.findAll({ featured: true }),
      ],
    );
    return { hero: heroRes, highlights, services, featuredProjects };
  }
}

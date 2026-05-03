import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { HomeBundleService } from './home-bundle.service';
import { HeroService } from '../hero/hero.service';
import { HighlightsService } from '../highlights/highlights.service';
import { ServicePricingService } from '../service-pricing/service-pricing.service';
import { ProjectsService } from '../projects/projects.service';

describe('HomeBundleService', () => {
  let service: HomeBundleService;
  let hero: { findOne: jest.Mock };
  let highlights: { findAll: jest.Mock };
  let servicePricing: { findAll: jest.Mock };
  let projects: { findAll: jest.Mock };

  beforeEach(async () => {
    hero = { findOne: jest.fn() };
    highlights = { findAll: jest.fn() };
    servicePricing = { findAll: jest.fn() };
    projects = { findAll: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomeBundleService,
        { provide: HeroService, useValue: hero },
        { provide: HighlightsService, useValue: highlights },
        { provide: ServicePricingService, useValue: servicePricing },
        { provide: ProjectsService, useValue: projects },
      ],
    }).compile();
    service = module.get(HomeBundleService);
  });

  it('getBundle() retourne {hero, highlights, services, featuredProjects} en parallèle', async () => {
    const heroData = { id: 'h1', name: 'Julien' };
    const highlightsData = [
      {
        id: 'hl1',
        title: 'Hi',
        description: 'Desc',
        icon: 'star',
        section: 'home',
        order: 0,
      },
    ];
    const servicesData = [
      {
        id: 'sp1',
        title: 'Web',
        price: '100',
        description: 'D',
        features: [],
        highlighted: false,
        enabled: true,
        order: 0,
      },
    ];
    const projectsData = [{ id: 'p1', title: 'Project 1', featured: true }];

    hero.findOne.mockResolvedValue(heroData);
    highlights.findAll.mockResolvedValue(highlightsData);
    servicePricing.findAll.mockResolvedValue(servicesData);
    projects.findAll.mockResolvedValue(projectsData);

    const result = await service.getBundle();

    expect(result).toEqual({
      hero: heroData,
      highlights: highlightsData,
      services: servicesData,
      featuredProjects: projectsData,
    });
    expect(highlights.findAll).toHaveBeenCalledWith('home');
    expect(projects.findAll).toHaveBeenCalledWith({ featured: true });
  });

  it('getBundle() retourne hero:null si HeroService.findOne throw', async () => {
    hero.findOne.mockRejectedValue(
      new InternalServerErrorException('Hero singleton missing'),
    );
    highlights.findAll.mockResolvedValue([]);
    servicePricing.findAll.mockResolvedValue([]);
    projects.findAll.mockResolvedValue([]);

    const result = await service.getBundle();

    expect(result.hero).toBeNull();
    expect(result.highlights).toEqual([]);
    expect(result.services).toEqual([]);
    expect(result.featuredProjects).toEqual([]);
  });

  it('getBundle() retourne arrays vides si tous les services retournent []', async () => {
    hero.findOne.mockResolvedValue(null);
    highlights.findAll.mockResolvedValue([]);
    servicePricing.findAll.mockResolvedValue([]);
    projects.findAll.mockResolvedValue([]);

    const result = await service.getBundle();

    expect(result).toEqual({
      hero: null,
      highlights: [],
      services: [],
      featuredProjects: [],
    });
  });
});

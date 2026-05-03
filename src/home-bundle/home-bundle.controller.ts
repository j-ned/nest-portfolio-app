import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HomeBundleService } from './home-bundle.service';

@ApiTags('HomeBundle')
@Controller('home-bundle')
export class HomeBundleController {
  constructor(private readonly bundle: HomeBundleService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({
    summary:
      'Aggregate landing page data (hero + home-highlights + services + featured projects)',
  })
  @ApiResponse({ status: 200, description: 'Aggregated home bundle' })
  getBundle() {
    return this.bundle.getBundle();
  }
}

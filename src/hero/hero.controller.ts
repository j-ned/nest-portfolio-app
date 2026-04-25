import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HeroService } from './hero.service';
import { UpdateHeroDto } from './dto/update-hero.dto';

@ApiTags('Hero')
@Controller('hero')
export class HeroController {
  constructor(private readonly hero: HeroService) {}

  @Get()
  @ApiOperation({ summary: 'Get the hero section (singleton)' })
  @ApiResponse({ status: 200, description: 'Hero' })
  findOne() {
    return this.hero.findOne();
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the hero (admin)' })
  @ApiResponse({ status: 200, description: 'Hero updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  update(@Body() dto: UpdateHeroDto) {
    return this.hero.update(dto);
  }
}

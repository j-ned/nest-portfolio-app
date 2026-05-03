import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BiographyService } from './biography.service';
import { UpdateBiographyDto } from './dto/update-biography.dto';

@ApiTags('Biography')
@Controller('biography')
export class BiographyController {
  constructor(private readonly biography: BiographyService) {}

  @Get()
  @ApiOperation({ summary: 'Get the biography section (subset of profile)' })
  @ApiResponse({ status: 200, description: 'Biography' })
  @ApiResponse({ status: 404, description: 'Biography not found' })
  findOne() {
    return this.biography.findOne();
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the biography (admin)' })
  @ApiResponse({ status: 200, description: 'Biography updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Biography not found' })
  update(@Body() dto: UpdateBiographyDto) {
    return this.biography.update(dto);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServicePricingService } from './service-pricing.service';
import { CreateServicePricingDto } from './dto/create-service-pricing.dto';
import { UpdateServicePricingDto } from './dto/update-service-pricing.dto';
import { ReorderServicePricingDto } from './dto/reorder-service-pricing.dto';

@ApiTags('ServicePricing')
@Controller('service-pricing')
export class ServicePricingController {
  constructor(private readonly sp: ServicePricingService) {}

  @Get()
  @ApiOperation({
    summary:
      'List all service pricings (public, sorted by order ASC, includes enabled=false)',
  })
  findAll() {
    return this.sp.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a service pricing by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sp.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a service pricing (admin)' })
  create(@Body() dto: CreateServicePricingDto) {
    return this.sp.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('reorder')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Reorder service pricings (admin, bulk). IDs absents conservent leur order.',
  })
  @ApiResponse({ status: 400, description: 'Some IDs not found' })
  reorder(@Body() dto: ReorderServicePricingDto) {
    return this.sp.reorder(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a service pricing (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServicePricingDto,
  ) {
    return this.sp.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a service pricing (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.sp.remove(id);
  }
}

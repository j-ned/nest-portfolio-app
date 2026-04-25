import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TechnologiesService } from './technologies.service';
import { CreateTechnologyDto } from './dto/create-technology.dto';
import { UpdateTechnologyDto } from './dto/update-technology.dto';

@ApiTags('Technologies')
@Controller('technologies')
export class TechnologiesController {
  constructor(private readonly technologies: TechnologiesService) {}

  @Get()
  @ApiOperation({ summary: 'List all technologies (public)' })
  findAll() {
    return this.technologies.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a technology by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.technologies.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a technology (admin)' })
  create(@Body() dto: CreateTechnologyDto) {
    return this.technologies.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a technology (admin)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTechnologyDto) {
    return this.technologies.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a technology (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.technologies.remove(id);
  }
}

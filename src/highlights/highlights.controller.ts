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
import { HighlightsService } from './highlights.service';
import { CreateHighlightDto } from './dto/create-highlight.dto';
import { UpdateHighlightDto } from './dto/update-highlight.dto';

@ApiTags('Highlights')
@Controller('highlights')
export class HighlightsController {
  constructor(private readonly service: HighlightsService) {}

  @Get()
  @ApiOperation({ summary: 'List profile highlights (public)' })
  findAll() {
    return this.service.findAll('profile');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a profile highlight by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id, 'profile');
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a profile highlight (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Body() dto: CreateHighlightDto) {
    return this.service.create(dto, 'profile');
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a profile highlight (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHighlightDto,
  ) {
    return this.service.update(id, dto, 'profile');
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a profile highlight (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id, 'profile');
  }
}

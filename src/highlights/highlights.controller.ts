import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HighlightsService } from './highlights.service';
import { CreateHighlightDto } from './dto/create-highlight.dto';
import { UpdateHighlightDto } from './dto/update-highlight.dto';

const HIGHLIGHT_SECTIONS = ['home', 'profile'] as const;
type HighlightSection = (typeof HIGHLIGHT_SECTIONS)[number];

@ApiTags('Highlights')
@Controller('highlights')
export class HighlightsController {
  constructor(private readonly service: HighlightsService) {}

  @Get(':section')
  @ApiOperation({ summary: 'List highlights for a section (home|profile, public)' })
  @ApiParam({ name: 'section', enum: HIGHLIGHT_SECTIONS })
  findAll(
    @Param('section', new ParseEnumPipe(HIGHLIGHT_SECTIONS)) section: HighlightSection,
  ) {
    return this.service.findAll(section);
  }

  @Get(':section/:id')
  @ApiOperation({ summary: 'Get a highlight by id within a section (public)' })
  @ApiParam({ name: 'section', enum: HIGHLIGHT_SECTIONS })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(
    @Param('section', new ParseEnumPipe(HIGHLIGHT_SECTIONS)) section: HighlightSection,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(id, section);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':section')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a highlight in a section (admin)' })
  @ApiParam({ name: 'section', enum: HIGHLIGHT_SECTIONS })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(
    @Param('section', new ParseEnumPipe(HIGHLIGHT_SECTIONS)) section: HighlightSection,
    @Body() dto: CreateHighlightDto,
  ) {
    return this.service.create(dto, section);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':section/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a highlight in a section (admin)' })
  @ApiParam({ name: 'section', enum: HIGHLIGHT_SECTIONS })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @Param('section', new ParseEnumPipe(HIGHLIGHT_SECTIONS)) section: HighlightSection,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHighlightDto,
  ) {
    return this.service.update(id, dto, section);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':section/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a highlight in a section (admin)' })
  @ApiParam({ name: 'section', enum: HIGHLIGHT_SECTIONS })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(
    @Param('section', new ParseEnumPipe(HIGHLIGHT_SECTIONS)) section: HighlightSection,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(id, section);
  }
}

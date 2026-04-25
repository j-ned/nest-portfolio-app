import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SocialLinksService } from './social-links.service';
import { CreateSocialLinkDto } from './dto/create-social-link.dto';
import { UpdateSocialLinkDto } from './dto/update-social-link.dto';

@ApiTags('SocialLinks')
@Controller('social-links')
export class SocialLinksController {
  constructor(private readonly social: SocialLinksService) {}

  @Get()
  @ApiOperation({ summary: 'List all social links (public)' })
  findAll() {
    return this.social.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a social link by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.social.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a social link (admin)' })
  create(@Body() dto: CreateSocialLinkDto) {
    return this.social.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a social link (admin)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSocialLinkDto) {
    return this.social.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a social link (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.social.remove(id);
  }
}

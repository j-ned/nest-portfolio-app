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
import { DiplomasService } from './diplomas.service';
import { CreateDiplomaDto } from './dto/create-diploma.dto';
import { UpdateDiplomaDto } from './dto/update-diploma.dto';

@ApiTags('Diplomas')
@Controller('diplomas')
export class DiplomasController {
  constructor(private readonly diplomas: DiplomasService) {}

  @Get()
  @ApiOperation({ summary: 'List all diplomas (public)' })
  findAll() {
    return this.diplomas.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a diploma by id (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.diplomas.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a diploma (admin)' })
  create(@Body() dto: CreateDiplomaDto) {
    return this.diplomas.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a diploma (admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiplomaDto,
  ) {
    return this.diplomas.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a diploma (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.diplomas.remove(id);
  }
}

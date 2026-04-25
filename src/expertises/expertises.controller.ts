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
import { ExpertisesService } from './expertises.service';
import { CreateExpertiseDto } from './dto/create-expertise.dto';
import { UpdateExpertiseDto } from './dto/update-expertise.dto';

@ApiTags('Expertises')
@Controller('expertises')
export class ExpertisesController {
  constructor(private readonly expertises: ExpertisesService) {}

  @Get('offers')
  @ApiOperation({ summary: 'List expertise offers (public, type=offer)' })
  findOffers() {
    return this.expertises.findOffers();
  }

  @Get('seeks')
  @ApiOperation({ summary: 'List expertise seeks (public, type=seek)' })
  findSeeks() {
    return this.expertises.findSeeks();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get an expertise by id (admin — includes type)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.expertises.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('offers')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an offer (admin, injects type=offer)' })
  createOffer(@Body() dto: CreateExpertiseDto) {
    return this.expertises.create('offer', dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('seeks')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a seek (admin, injects type=seek)' })
  createSeek(@Body() dto: CreateExpertiseDto) {
    return this.expertises.create('seek', dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an expertise (admin, type non modifiable)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpertiseDto,
  ) {
    return this.expertises.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an expertise (admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.expertises.remove(id);
  }
}

import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PublicReadThrottle } from '../common/throttle';
import { UpdateWorkshopGuideDto } from './dto/update-workshop-guide.dto';
import { WorkshopGuideService } from './workshop-guide.service';

@ApiTags('Workshop guide')
@Controller('workshop-guide')
export class WorkshopGuideController {
  constructor(private readonly guide: WorkshopGuideService) {}

  @PublicReadThrottle()
  @Get()
  @ApiOperation({
    summary:
      'Get the insert guide (public): enabled, decoderEnabled (ISO code decoder, false when never set), entries, version, updatedAt. Without a stored document: disabled, decoder off, no entry, version 0.',
  })
  findCurrent() {
    return this.guide.findCurrent();
  }

  @UseGuards(JwtAuthGuard)
  @Put()
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Replace the whole insert guide (admin). decoderEnabled is optional: when absent, the stored value is kept. An identical document at the current version writes nothing; version 0 creates it.',
  })
  @ApiResponse({ status: 400, description: 'Invalid document' })
  @ApiResponse({ status: 409, description: 'Stale version' })
  replace(@Body() dto: UpdateWorkshopGuideDto) {
    return this.guide.replace(dto);
  }
}

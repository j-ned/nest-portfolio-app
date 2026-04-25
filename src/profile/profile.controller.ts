import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get the public profile (singleton)' })
  @ApiResponse({ status: 200, description: 'Profile' })
  findOne() {
    return this.profile.findOne();
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the profile (admin)' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  update(@Body() dto: UpdateProfileDto) {
    return this.profile.update(dto);
  }
}

import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  ParseFilePipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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

  @UseGuards(JwtAuthGuard)
  @Post('avatar')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary:
      'Upload/replace profile avatar (admin, max 5MB, image/webp|jpeg|png|avif)',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile with avatar uploaded and URL transformed',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 422,
    description: 'File too large or unsupported MIME type',
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({
            fileType: /^image\/(webp|jpeg|png|avif)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.profile.uploadAvatar(file);
  }
}

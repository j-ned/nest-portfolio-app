import {
  Controller,
  FileTypeValidator,
  Get,
  HttpStatus,
  MaxFileSizeValidator,
  ParseFilePipe,
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
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
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

import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  Put,
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
import { PublicReadThrottle } from '../common/throttle';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfilePortraitService } from './profile-portrait.service';
import { ProfileService } from './profile.service';

@ApiTags('Profile')
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly portrait: ProfilePortraitService,
  ) {}

  @PublicReadThrottle()
  @Get()
  @ApiOperation({ summary: 'Get the content of the About page (public)' })
  @ApiResponse({ status: 404, description: 'Profile content not seeded' })
  findCurrent() {
    return this.profile.findCurrent();
  }

  @UseGuards(JwtAuthGuard)
  @Put()
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Replace the whole About content (admin). An identical document at the current version writes nothing.',
  })
  @ApiResponse({ status: 400, description: 'Invalid document' })
  @ApiResponse({ status: 409, description: 'Stale version' })
  replace(@Body() dto: UpdateProfileDto) {
    return this.profile.replace(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('portrait')
  @HttpCode(HttpStatus.OK)
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
      'Replace the portrait (admin, max 5MB, image/webp|jpeg|png|avif, stored as AVIF 640×800).',
  })
  @ApiResponse({
    status: 422,
    description: 'File missing, too large, unsupported or unreadable',
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadPortrait(
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
    return this.portrait.replace(file);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('portrait')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Go back to the default portrait (admin).',
  })
  removePortrait() {
    return this.portrait.remove();
  }
}

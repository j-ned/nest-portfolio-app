import {
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  Res,
  StreamableFile,
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
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CvService } from './cv.service';
import { UploadCvResponseDto } from './dto/upload-cv-response.dto';

@ApiTags('CV')
@Controller('cv')
export class CvController {
  constructor(private readonly cv: CvService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
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
    summary: 'Upload/replace CV (admin, max 10MB, application/pdf only)',
  })
  @ApiResponse({ status: 201, type: UploadCvResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 422,
    description: 'File too large or unsupported MIME type',
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile(
      new ParseFilePipe({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^application\/pdf$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.cv.upsert(file);
  }

  @Get()
  @ApiOperation({
    summary: 'Get CV metadata (public, returns null if no CV)',
  })
  findOne() {
    return this.cv.findLatestMetadata();
  }

  @Get('download')
  @ApiOperation({
    summary: 'Download the CV (public, attachment with original filename)',
  })
  @ApiResponse({ status: 200, description: 'PDF stream' })
  @ApiResponse({ status: 404, description: 'No CV uploaded' })
  async download(
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, metadata } = await this.cv.download();
    res.set({
      'Content-Type': metadata.mimeType,
      'Content-Disposition': `attachment; filename="${metadata.fileName}"`,
      'Content-Length': metadata.fileSize.toString(),
    });
    return new StreamableFile(stream);
  }

  @UseGuards(JwtAuthGuard)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete the current CV (admin)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No CV uploaded' })
  remove() {
    return this.cv.remove();
  }
}

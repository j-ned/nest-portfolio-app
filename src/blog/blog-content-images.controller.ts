import {
  Controller,
  FileTypeValidator,
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
import { AdminWriteThrottle } from '../common/throttle';
import { BlogContentImagesService } from './blog-content-images.service';

/** Images du corps des articles : aucune ligne en base, le Markdown cite l'URL renvoyée. */
@ApiTags('Blog')
@ApiBearerAuth()
@Controller('blog/content-images')
export class BlogContentImagesController {
  constructor(private readonly images: BlogContentImagesService) {}

  @UseGuards(JwtAuthGuard)
  @AdminWriteThrottle()
  @Post()
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
      'Upload an image for a blog post body (admin, max 5MB, image/webp|jpeg|png|avif, stored as AVIF ≤ 1600px, not attached to any post)',
  })
  @ApiResponse({
    status: 201,
    description:
      'Stored image: public URL relative to the API (/storage/portfolio-storage/blog-content/<uuid>-<sha8>-<w>x<h>.avif) and intrinsic dimensions',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
      },
      required: ['url', 'width', 'height'],
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 413, description: 'File larger than 5MB' })
  @ApiResponse({
    status: 422,
    description: 'Missing file, unsupported MIME type or unreadable image',
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(
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
    return this.images.upload(file);
  }
}

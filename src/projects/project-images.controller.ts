import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
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
import { AdminWriteThrottle } from '../common/throttle';
import { ProjectImageAltDto } from './dto/project-image-alt.dto';
import { ReorderProjectImagesDto } from './dto/reorder-project-images.dto';
import { PROJECT_GALLERY_MAX, PROJECT_IMAGE_ALT_MAX } from './project-gallery';
import { ProjectImagesService } from './project-images.service';

/** Galerie d'un projet (ADR-0009) : écritures admin seulement, la lecture passe par GET /projects. */
@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects/:id/images')
export class ProjectImagesController {
  constructor(private readonly images: ProjectImagesService) {}

  @UseGuards(JwtAuthGuard)
  @AdminWriteThrottle()
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        alt: { type: 'string', maxLength: PROJECT_IMAGE_ALT_MAX },
      },
      required: ['file', 'alt'],
    },
  })
  @ApiOperation({
    summary: `Add a gallery image (admin, max 5MB, image/webp|jpeg|png|avif, stored as AVIF ≤ 1600px, ${PROJECT_GALLERY_MAX} images max)`,
  })
  @ApiResponse({ status: 400, description: 'Invalid alt' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 413, description: 'File larger than 5MB' })
  @ApiResponse({
    status: 422,
    description: 'Unsupported or unreadable image, or gallery full',
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('id', ParseUUIDPipe) id: string,
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
    @Body() dto: ProjectImageAltDto,
  ) {
    return this.images.upload(id, file, dto.alt);
  }

  @UseGuards(JwtAuthGuard)
  @AdminWriteThrottle()
  @Patch(':imageId')
  @ApiOperation({ summary: 'Update the alt text of a gallery image (admin)' })
  @ApiResponse({ status: 400, description: 'Invalid alt' })
  @ApiResponse({
    status: 404,
    description: 'Image not found in this project',
  })
  updateAlt(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Body() dto: ProjectImageAltDto,
  ) {
    return this.images.updateAlt(id, imageId, dto.alt);
  }

  @UseGuards(JwtAuthGuard)
  @AdminWriteThrottle()
  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a gallery image + its S3 object (admin)' })
  @ApiResponse({
    status: 404,
    description: 'Image not found in this project',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.images.remove(id, imageId);
  }

  @UseGuards(JwtAuthGuard)
  @AdminWriteThrottle()
  @Put('order')
  @ApiOperation({
    summary:
      'Reorder the gallery (admin). imageIds must be every image id of the project, in the new order.',
  })
  @ApiResponse({ status: 200, description: 'The whole gallery, sorted' })
  @ApiResponse({ status: 400, description: 'Malformed imageIds' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({
    status: 422,
    description: 'imageIds is not a permutation of the gallery',
  })
  reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderProjectImagesDto,
  ) {
    return this.images.reorder(id, dto.imageIds);
  }
}

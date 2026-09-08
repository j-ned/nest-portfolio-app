import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
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
import { PublicReadThrottle } from '../common/throttle';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { BlogService } from './blog.service';

@ApiTags('Blog')
@Controller('blog/posts')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @PublicReadThrottle()
  @Get()
  @ApiOperation({ summary: 'List published blog posts (public)' })
  findAllPublished() {
    return this.blog.findAllPublished();
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all blog posts including drafts (admin)' })
  findAllForAdmin() {
    return this.blog.findAllForAdmin();
  }

  @PublicReadThrottle()
  @Get(':slug')
  @ApiOperation({ summary: 'Get a published blog post by slug (public)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findBySlug(@Param('slug') slug: string) {
    return this.blog.findBySlug(slug);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a blog post (admin)' })
  @ApiResponse({ status: 409, description: 'Slug already exists' })
  create(@Body() dto: CreateBlogPostDto) {
    return this.blog.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update a blog post (admin). Pass coverImage:null to remove it.',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Slug already exists' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlogPostDto,
  ) {
    return this.blog.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a blog post + its S3 cover image (admin)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.remove(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/image')
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
      'Upload/replace cover image (admin, max 5MB, image/webp|jpeg|png|avif)',
  })
  @ApiResponse({
    status: 422,
    description: 'File too large or unsupported MIME type',
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadCoverImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipe({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(webp|jpeg|png|avif)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.blog.uploadCoverImage(id, file);
  }

  @Post(':slug/like')
  @ApiOperation({
    summary: 'Increment the like counter of a post (public, no auth)',
  })
  like(@Param('slug') slug: string) {
    return this.blog.like(slug);
  }
}

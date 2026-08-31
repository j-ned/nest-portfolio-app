import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Equals, IsOptional } from 'class-validator';
import { CreateBlogPostDto } from './create-blog-post.dto';

export class UpdateBlogPostDto extends PartialType(CreateBlogPostDto) {
  @ApiPropertyOptional({
    type: 'null',
    nullable: true,
    description:
      'Pass null to remove the cover image (also deletes from S3). Use POST /:id/image to upload a new one.',
  })
  @IsOptional()
  @Equals(null)
  coverImage?: null;
}

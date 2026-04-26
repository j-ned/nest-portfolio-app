import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Equals, IsOptional } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @ApiPropertyOptional({
    type: 'null',
    nullable: true,
    description:
      'Pass null to remove image (also deletes from S3). Use POST /:id/image to upload a new one.',
  })
  @IsOptional()
  @Equals(null)
  image?: null;
}

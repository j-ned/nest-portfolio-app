import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Equals, IsOptional } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

// skipNullProperties: false : PartialType pose sinon un @IsOptional qui laisse passer null sur
// tous les champs, dont `kind` (NOT NULL) et les champs requis. Les champs qui acceptent null
// (liens, image) le déclarent eux-mêmes.
export class UpdateProjectDto extends PartialType(CreateProjectDto, {
  skipNullProperties: false,
}) {
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

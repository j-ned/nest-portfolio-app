import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PROJECT_IMAGE_ALT_MAX } from '../project-gallery';

/** Texte alternatif d'une capture : champ texte du multipart d'upload et corps du PATCH. */
export class ProjectImageAltDto {
  @ApiProperty({
    maxLength: PROJECT_IMAGE_ALT_MAX,
    example: 'Tableau de bord avec trois graphiques de ventes',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(PROJECT_IMAGE_ALT_MAX)
  alt!: string;
}

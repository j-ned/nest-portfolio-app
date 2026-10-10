import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsUUID,
  Matches,
} from 'class-validator';
import {
  PROFILE_LIMITS,
  PROFILE_TECHNOLOGY_ICON_PATTERN,
} from '../profile-limits';
import { ProfileText } from './profile-text.decorator';

const L = PROFILE_LIMITS;

export class ProfileBiographyDto {
  @ApiProperty({ maxLength: L.biography.title })
  @ProfileText(L.biography.title)
  title!: string;

  @ApiProperty({ maxLength: L.biography.summary })
  @ProfileText(L.biography.summary)
  summary!: string;

  @ApiProperty({
    maxLength: L.biography.leadEmphasis,
    description:
      "Suite de l'accroche, après la phrase d'identité (code du front)",
  })
  @ProfileText(L.biography.leadEmphasis)
  leadEmphasis!: string;

  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: L.biography.paragraphs,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(L.biography.paragraphs)
  @ProfileText(L.biography.paragraph, { each: true })
  paragraphs!: string[];
}

export class ProfileHighlightDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ maxLength: L.highlight.title })
  @ProfileText(L.highlight.title)
  title!: string;

  @ApiProperty({ maxLength: L.highlight.description })
  @ProfileText(L.highlight.description)
  description!: string;
}

export class ProfileWhatIDoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ maxLength: L.whatIDo.title })
  @ProfileText(L.whatIDo.title)
  title!: string;

  @ApiProperty({ maxLength: L.whatIDo.description })
  @ProfileText(L.whatIDo.description)
  description!: string;
}

export class ProfileTechnologyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ maxLength: L.technology.name })
  @ProfileText(L.technology.name)
  name!: string;

  @ApiProperty({ maxLength: L.technology.category })
  @ProfileText(L.technology.category)
  category!: string;

  @ApiProperty({
    pattern: PROFILE_TECHNOLOGY_ICON_PATTERN.source,
    description: 'Nom de fichier de public/icons/ côté front, sans extension',
  })
  @Matches(PROFILE_TECHNOLOGY_ICON_PATTERN)
  icon!: string;
}

export class ProfileDiplomaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ maxLength: L.diploma.title })
  @ProfileText(L.diploma.title)
  title!: string;

  @ApiProperty({ maxLength: L.diploma.provider })
  @ProfileText(L.diploma.provider)
  provider!: string;

  @ApiProperty({ maxLength: L.diploma.level })
  @ProfileText(L.diploma.level)
  level!: string;

  @ApiProperty({ maxLength: L.diploma.shortDescription })
  @ProfileText(L.diploma.shortDescription)
  shortDescription!: string;

  @ApiProperty({ type: [String], minItems: 1, maxItems: L.diploma.skills })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(L.diploma.skills)
  @ProfileText(L.diploma.skill, { each: true })
  skills!: string[];
}

export class ProfileMotivationDto {
  @ApiProperty({ maxLength: L.motivation.title })
  @ProfileText(L.motivation.title)
  title!: string;

  @ApiProperty({ maxLength: L.motivation.statement })
  @ProfileText(L.motivation.statement)
  statement!: string;

  @ApiProperty({ maxLength: L.motivation.description })
  @ProfileText(L.motivation.description)
  description!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  PROJECT_KINDS,
  type ProjectKind,
} from '../../database/schema/projects';
import { ArchitectureDecisionDto } from './architecture-decision.dto';
import { TechChoiceDto } from './tech-choice.dto';

export class CreateProjectDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category!: string;

  @ApiPropertyOptional({ type: [String], example: ['Angular', 'NestJS'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({ format: 'uri', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl()
  liveUrl?: string | null;

  @ApiPropertyOptional({ format: 'uri', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl()
  repoUrl?: string | null;

  @ApiPropertyOptional({ format: 'uri', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl()
  repoUrlFront?: string | null;

  @ApiPropertyOptional({ format: 'uri', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl()
  repoUrlBack?: string | null;

  @ApiPropertyOptional({ type: [TechChoiceDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TechChoiceDto)
  techChoices?: TechChoiceDto[];

  @ApiPropertyOptional({ type: [ArchitectureDecisionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ArchitectureDecisionDto)
  architectureDecisions?: ArchitectureDecisionDto[];

  @ApiPropertyOptional({ enum: PROJECT_KINDS, default: 'demo' })
  // Optionnel mais jamais null : la colonne est NOT NULL (ADR-0008 §4). Pas de @IsOptional,
  // qui laisserait passer null jusqu'à une erreur 500 en base.
  @ValidateIf((_, v) => v !== undefined)
  @IsIn([...PROJECT_KINDS])
  kind?: ProjectKind;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

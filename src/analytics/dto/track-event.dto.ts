import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ANALYTICS_TYPES = [
  'page_view',
  'page_duration',
  'project_click',
  'article_view',
  'cv_download',
] as const;
export type AnalyticsType = (typeof ANALYTICS_TYPES)[number];

export class TrackEventDto {
  @ApiProperty({
    description: "Type d'événement tracké (page event ou custom event)",
    enum: ANALYTICS_TYPES,
  })
  @IsIn([...ANALYTICS_TYPES])
  type!: AnalyticsType;

  @ApiPropertyOptional({
    description: 'Path de la page (requis pour page_view et page_duration)',
    maxLength: 2048,
  })
  @ValidateIf(
    (o: TrackEventDto) => o.type === 'page_view' || o.type === 'page_duration',
  )
  @IsString()
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  referrer?: string;

  @ApiPropertyOptional({ description: 'Durée en secondes (0-86400)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  duration?: number;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  entityId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  entityTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

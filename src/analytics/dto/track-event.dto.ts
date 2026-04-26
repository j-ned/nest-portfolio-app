import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ANALYTICS_EVENT_TYPES = [
  'project_click',
  'article_view',
  'cv_download',
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export class TrackEventDto {
  @ApiProperty({
    description: 'Path uniquement (ex: /projects/foo)',
    maxLength: 2048,
  })
  @IsString()
  @MaxLength(2048)
  url!: string;

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

  @ApiPropertyOptional({ enum: ANALYTICS_EVENT_TYPES })
  @IsOptional()
  @IsIn([...ANALYTICS_EVENT_TYPES])
  eventType?: AnalyticsEventType;

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

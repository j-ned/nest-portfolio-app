import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export const METRIC_TYPES = [
  'url',
  'referrer',
  'browser',
  'country',
  'os',
] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export class DateRangeQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    description: 'Default = il y a 30 jours (UTC)',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    format: 'date',
    description: "Default = aujourd'hui (UTC)",
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MetricsQueryDto extends DateRangeQueryDto {
  @ApiProperty({ enum: METRIC_TYPES })
  @IsIn([...METRIC_TYPES])
  type!: MetricType;
}

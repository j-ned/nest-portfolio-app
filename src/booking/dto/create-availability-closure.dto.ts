import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** Date calendaire `YYYY-MM-DD` : la forme est imposée par le motif, l'existence par `strict`. */
const PARIS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAvailabilityClosureDto {
  @ApiProperty({ format: 'date', description: 'Premier jour fermé (Paris)' })
  @Matches(PARIS_DATE)
  @IsISO8601({ strict: true })
  startsOn!: string;

  @ApiProperty({
    format: 'date',
    description: 'Dernier jour fermé, inclus (Paris)',
  })
  @Matches(PARIS_DATE)
  @IsISO8601({ strict: true })
  endsOn!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

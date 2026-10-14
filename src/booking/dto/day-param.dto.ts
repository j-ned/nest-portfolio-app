import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';

/** Date calendaire `YYYY-MM-DD` : la forme est imposée par le motif, l'existence par `strict`. */
const PARIS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DayParamDto {
  @ApiProperty({ format: 'date', description: 'Jour de Paris' })
  @Matches(PARIS_DATE)
  @IsISO8601({ strict: true })
  date!: string;
}

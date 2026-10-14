import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

/** Mois `YYYY-MM`, mois de 01 à 12. */
const PARIS_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CalendarQueryDto {
  @ApiPropertyOptional({
    example: '2026-11',
    description: 'Mois de Paris (YYYY-MM) ; absent → mois courant',
  })
  @IsOptional()
  @Matches(PARIS_MONTH)
  month?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ListSlotsDto {
  @ApiProperty({ example: '2026-04', description: 'Month in YYYY-MM format' })
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Month must be YYYY-MM' })
  month!: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelBookingByOwnerDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Motif transmis au visiteur dans l’email d’annulation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

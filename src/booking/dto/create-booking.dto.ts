import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { Booking } from '../../database/schema';

const BOOKING_FORMATS = [
  'video',
  'phone',
] as const satisfies readonly Booking['format'][];

export class CreateBookingDto {
  @ApiProperty({
    format: 'date-time',
    description: 'Début du créneau choisi, ISO 8601',
  })
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ format: 'email', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ enum: BOOKING_FORMATS })
  @IsIn(BOOKING_FORMATS)
  format!: Booking['format'];

  @ApiPropertyOptional({
    description: 'Requis en format téléphone ; ignoré (non stocké) en visio',
  })
  @ValidateIf((dto: CreateBookingDto) => dto.format === 'phone')
  @IsString()
  @Matches(/^\+?[0-9][0-9 .-]{5,19}$/)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;

  /** Champ piège : invisible pour un humain, rempli par un robot. Déclaré pour passer la liste blanche. */
  @ApiPropertyOptional({ maxLength: 200, description: 'Laisser vide' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

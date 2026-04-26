import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ format: 'date', example: '2026-04-26' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ example: '14:30' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Time must be HH:mm' })
  startTime!: string;

  @ApiProperty({ example: 60, minimum: 15 })
  @IsInt()
  @Min(15)
  duration!: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ format: 'email', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: '0612345678' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Phone must be 10 digits (FR)' })
  phone!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message!: string;
}

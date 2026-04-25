import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDiplomaDto {
  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  provider!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString() @IsNotEmpty() @MaxLength(1000)
  shortDescription!: string;

  @ApiPropertyOptional({ type: [String], example: ['TypeScript', 'NestJS'] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true })
  skills?: string[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateServicePricingDto {
  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString() @IsNotEmpty() @MaxLength(1000)
  description!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString() @IsNotEmpty() @MaxLength(200)
  price!: string;

  @ApiPropertyOptional({ type: [String], default: [] })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true })
  features?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  highlighted?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional() @IsInt() @Min(0)
  order?: number;
}

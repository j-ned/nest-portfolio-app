import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateSocialLinkDto {
  @ApiProperty({ maxLength: 50, example: 'github' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  icon!: string;

  @ApiProperty({ maxLength: 100, example: 'GitHub' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  label!: string;

  @ApiProperty({ maxLength: 500, example: 'https://github.com/jned' })
  @IsString() @IsUrl() @MaxLength(500)
  href!: string;
}

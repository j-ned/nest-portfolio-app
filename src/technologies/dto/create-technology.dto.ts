import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTechnologyDto {
  @ApiProperty({ maxLength: 100, example: 'TypeScript' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ maxLength: 50, example: 'language' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category!: string;

  @ApiProperty({ maxLength: 100, example: 'devicon-typescript-plain' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  icon!: string;
}

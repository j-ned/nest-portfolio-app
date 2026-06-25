import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ArchitectureDecisionDto {
  @ApiProperty({ maxLength: 150 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  decision!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  rationale!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class TwoFactorDisableDto {
  @ApiProperty()
  @IsString()
  @MinLength(12)
  password!: string;
}

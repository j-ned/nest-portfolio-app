import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDivisibleBy,
  IsInt,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class AvailabilityRuleDto {
  @ApiProperty({ minimum: 1, maximum: 7, description: 'Jour ISO, 1 = lundi' })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 1440,
    multipleOf: 30,
    description: 'Début en minutes depuis minuit, heure de Paris',
  })
  @IsInt()
  @Min(0)
  @Max(1440)
  @IsDivisibleBy(30)
  startMinute!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 1440,
    multipleOf: 30,
    description: 'Fin exclusive en minutes depuis minuit, heure de Paris',
  })
  @IsInt()
  @Min(0)
  @Max(1440)
  @IsDivisibleBy(30)
  endMinute!: number;
}

export class ReplaceAvailabilityRulesDto {
  @ApiProperty({ type: [AvailabilityRuleDto], maxItems: 168 })
  @IsArray()
  @ArrayMaxSize(168)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityRuleDto)
  rules!: AvailabilityRuleDto[];
}

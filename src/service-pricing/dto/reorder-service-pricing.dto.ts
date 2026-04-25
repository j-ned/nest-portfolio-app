import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReorderServicePricingDto {
  @ApiProperty({
    type: [String],
    description: 'IDs in desired order (index 0 = first)',
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  orderedIds!: string[];
}

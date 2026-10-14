import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class SetDayOpenDto {
  @ApiProperty({ description: 'État souhaité du jour : ouvert ou fermé' })
  // Valeur brute du corps : la conversion implicite du `ValidationPipe` global ferait de "false"
  // un `true` et de 0 un `false` avant `@IsBoolean()`.
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.open)
  @IsBoolean()
  open!: boolean;
}

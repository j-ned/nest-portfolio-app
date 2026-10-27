import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsPositive,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ProfileText } from '../../profile/dto/profile-text.decorator';
import {
  WORKSHOP_GUIDE_OPERATIONS,
  type WorkshopGuideOperation,
} from '../workshop-guide-content';
import { WORKSHOP_GUIDE_LIMITS } from '../workshop-guide-limits';

const L = WORKSHOP_GUIDE_LIMITS;

/** Remarque renseignée : une chaîne vide ou blanche vaut « pas de remarque » (champ facultatif du formulaire). */
const hasNote = ({ note }: WorkshopGuideEntryDto): boolean =>
  typeof note === 'string' ? note.trim() !== '' : note != null;

export class WorkshopGuideEntryDto {
  @ApiProperty({ maxLength: L.material, example: 'Inox 304L' })
  @ProfileText(L.material)
  material!: string;

  @ApiProperty({ enum: WORKSHOP_GUIDE_OPERATIONS })
  @IsIn([...WORKSHOP_GUIDE_OPERATIONS])
  operation!: WorkshopGuideOperation;

  @ApiProperty({ maxLength: L.insert, example: 'CNMG 120408' })
  @ProfileText(L.insert)
  insert!: string;

  @ApiProperty({
    description: 'Rayon de bec en mm, deux décimales au plus',
    exclusiveMinimum: true,
    minimum: 0,
    maximum: L.noseRadius,
    example: 0.8,
  })
  @IsNumber({
    maxDecimalPlaces: L.noseRadiusDecimals,
    allowNaN: false,
    allowInfinity: false,
  })
  @IsPositive()
  @Max(L.noseRadius)
  noseRadius!: number;

  @ApiPropertyOptional({
    maxLength: L.note,
    nullable: true,
    description: 'Facultative : absente, null ou vide = pas de remarque',
  })
  @ValidateIf(hasNote)
  @ProfileText(L.note)
  note?: string | null;
}

/**
 * Remplacement complet du guide des plaquettes (spec 035 du front) : l'interrupteur, les lignes et
 * la `version` lue. Version 0 = aucun document encore enregistré.
 */
export class UpdateWorkshopGuideDto {
  @ApiProperty({
    minimum: 0,
    description:
      'Version lue avant édition (409 si elle a changé ; 0 = aucun document encore)',
  })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({ description: 'Guide visible sur le site' })
  // La conversion implicite ferait de "false" un `true` : on valide la valeur reçue, telle quelle.
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ type: [WorkshopGuideEntryDto], maxItems: L.entries })
  @IsArray()
  @ArrayMaxSize(L.entries)
  @ValidateNested({ each: true })
  @Type(() => WorkshopGuideEntryDto)
  entries!: WorkshopGuideEntryDto[];
}

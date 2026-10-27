import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
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

/** Ligne « toutes matières » (spec 037) : seul `true` en fait une ; absent, `false` ou `null` non. */
const isAllMaterials = ({ allMaterials }: WorkshopGuideEntryDto): boolean =>
  allMaterials === true;

export class WorkshopGuideEntryDto {
  @ApiPropertyOptional({
    description:
      'Ligne valable pour toutes les matières (spec 037). Vrai : `material` est ignoré et peut manquer. Booléen JSON strict',
  })
  // Même garde que `enabled` : "true" n'est jamais converti.
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsOptional()
  @IsBoolean()
  allMaterials?: boolean | null;

  @ApiPropertyOptional({
    maxLength: L.material,
    example: 'Inox 304L',
    description:
      'Obligatoire, sauf sur une ligne « toutes matières » où il est ignoré',
  })
  @ValidateIf((entry: WorkshopGuideEntryDto) => !isAllMaterials(entry))
  @ProfileText(L.material)
  material?: string | null;

  @ApiProperty({ enum: WORKSHOP_GUIDE_OPERATIONS })
  @IsIn([...WORKSHOP_GUIDE_OPERATIONS])
  operation!: WorkshopGuideOperation;

  @ApiProperty({ maxLength: L.insert, example: 'CNMG 120408' })
  @ProfileText(L.insert)
  insert!: string;

  @ApiPropertyOptional({
    description:
      'Rayon de bec en mm, deux décimales au plus. Facultatif (spec 037) : absent ou null = non renseigné',
    nullable: true,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: L.noseRadius,
    example: 0.8,
  })
  @ValidateIf(({ noseRadius }: WorkshopGuideEntryDto) => noseRadius != null)
  @IsNumber({
    maxDecimalPlaces: L.noseRadiusDecimals,
    allowNaN: false,
    allowInfinity: false,
  })
  @IsPositive()
  @Max(L.noseRadius)
  noseRadius?: number | null;

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

  @ApiProperty({ description: 'Guide des plaquettes visible sur le site' })
  // La conversion implicite ferait de "false" un `true` : on valide la valeur reçue, telle quelle.
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    description:
      'Décodeur de code ISO visible sur le site (spec 036). Facultatif : absent, la valeur stockée est conservée (false si aucune). Booléen JSON strict, null refusé',
  })
  // Même garde que `enabled` : "false" n'est jamais converti. Seul l'absent passe la validation.
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @ValidateIf(
    ({ decoderEnabled }: UpdateWorkshopGuideDto) =>
      decoderEnabled !== undefined,
  )
  @IsBoolean()
  decoderEnabled?: boolean;

  @ApiProperty({ type: [WorkshopGuideEntryDto], maxItems: L.entries })
  @IsArray()
  @ArrayMaxSize(L.entries)
  @ValidateNested({ each: true })
  @Type(() => WorkshopGuideEntryDto)
  entries!: WorkshopGuideEntryDto[];
}

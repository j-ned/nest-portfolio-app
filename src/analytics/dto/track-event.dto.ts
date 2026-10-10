import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { V2_EVENT_TYPES } from '../engagement';

export const ANALYTICS_TYPES = [
  'page_view',
  'page_duration',
  'project_click',
  'article_view',
  'article_read',
  'cv_download',
  'cta_click',
  'contact_submit',
  'outbound_click',
  'section_view',
] as const;
export type AnalyticsType = (typeof ANALYTICS_TYPES)[number];

/** Canal d'un lien sortant : jamais l'adresse elle-même (RGPD, spec 020). */
export const OUTBOUND_CHANNELS = [
  'email',
  'phone',
  'malt',
  'discord',
  'linkedin',
  'github',
  'demo',
] as const;
export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[number];

const SECTION_IDS = ['home_contact'] as const;

/** Emplacement d'un formulaire de contact : `home`, `offer_site-vitrine`. */
const CONTACT_PLACEMENT = /^[a-z0-9_-]{1,64}$/;

const ENTITY_ID_RULES: Partial<Record<AnalyticsType, (id: string) => boolean>> =
  {
    contact_submit: (id) => CONTACT_PLACEMENT.test(id),
    outbound_click: (id) =>
      (OUTBOUND_CHANNELS as readonly string[]).includes(id),
    section_view: (id) => (SECTION_IDS as readonly string[]).includes(id),
  };

const entityIdRule = (type: AnalyticsType) =>
  Object.hasOwn(ENTITY_ID_RULES, type) ? ENTITY_ID_RULES[type] : undefined;

@ValidatorConstraint({ name: 'entityIdForType' })
class EntityIdForType implements ValidatorConstraintInterface {
  validate(entityId: unknown, args: ValidationArguments): boolean {
    const rule = entityIdRule((args.object as TrackEventDto).type);
    return !rule || (typeof entityId === 'string' && rule(entityId));
  }

  defaultMessage(args: ValidationArguments): string {
    return `entityId is not valid for type ${(args.object as TrackEventDto).type}`;
  }
}

/** Chemin d'une page du site, court, sans requête ni ancre ni texte libre. */
const TRACKED_PATH = /^\/[A-Za-z0-9\-._~/%]{0,199}$/;

const isV2Event = (type: AnalyticsType): boolean =>
  (V2_EVENT_TYPES as readonly AnalyticsType[]).includes(type);

/** Ne garde que le chemin : une requête (`?email=…`) ou une ancre n'entre jamais en base. */
const toPathForV2 = ({ value, obj }: { value: unknown; obj: unknown }) =>
  isV2Event((obj as TrackEventDto).type) && typeof value === 'string'
    ? value.split(/[?#]/, 1)[0]
    : value;

@ValidatorConstraint({ name: 'pathForV2Events' })
class PathForV2Events implements ValidatorConstraintInterface {
  validate(entityTitle: unknown, args: ValidationArguments): boolean {
    return (
      !isV2Event((args.object as TrackEventDto).type) ||
      (typeof entityTitle === 'string' && TRACKED_PATH.test(entityTitle))
    );
  }

  defaultMessage(): string {
    return 'entityTitle must be a site path for this event type';
  }
}

@ValidatorConstraint({ name: 'noMetadataForV2Events' })
class NoMetadataForV2Events implements ValidatorConstraintInterface {
  validate(metadata: unknown, args: ValidationArguments): boolean {
    return !isV2Event((args.object as TrackEventDto).type) || metadata == null;
  }

  defaultMessage(): string {
    return 'metadata is not accepted for this event type';
  }
}

export class TrackEventDto {
  @ApiProperty({
    description: "Type d'événement tracké (page event ou custom event)",
    enum: ANALYTICS_TYPES,
  })
  @IsIn([...ANALYTICS_TYPES])
  type!: AnalyticsType;

  @ApiPropertyOptional({
    description: 'Path de la page (requis pour page_view et page_duration)',
    maxLength: 2048,
  })
  @ValidateIf(
    (o: TrackEventDto) => o.type === 'page_view' || o.type === 'page_duration',
  )
  @IsString()
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  referrer?: string;

  @ApiPropertyOptional({
    description: 'Durée en secondes (0-86400), requise pour page_duration',
  })
  @ValidateIf(
    (o: TrackEventDto) => o.type === 'page_duration' || o.duration != null,
  )
  @IsInt()
  @Min(0)
  @Max(86400)
  duration?: number;

  @ApiPropertyOptional({
    maxLength: 255,
    description:
      'Requis pour contact_submit (emplacement /^[a-z0-9_-]{1,64}$/), outbound_click (canal) et section_view (section)',
  })
  @ValidateIf(
    (o: TrackEventDto) =>
      entityIdRule(o.type) !== undefined || o.entityId != null,
  )
  @IsString()
  @MaxLength(255)
  @Validate(EntityIdForType)
  entityId?: string;

  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Libre pour les événements historiques ; chemin de la page (≤ 200, sans requête) pour contact_submit, outbound_click et section_view',
  })
  @Transform(toPathForV2)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Validate(PathForV2Events)
  entityTitle?: string;

  @ApiPropertyOptional({
    description: 'Refusé pour contact_submit, outbound_click et section_view',
  })
  @IsOptional()
  @IsObject()
  @Validate(NoMetadataForV2Events)
  metadata?: Record<string, unknown>;
}

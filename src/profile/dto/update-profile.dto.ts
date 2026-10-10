import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { PROFILE_LIMITS } from '../profile-limits';
import {
  ProfileBiographyDto,
  ProfileDiplomaDto,
  ProfileHighlightDto,
  ProfileMotivationDto,
  ProfileTechnologyDto,
  ProfileWhatIDoDto,
} from './profile-items.dto';
import { ProfileItemList, ProfileSection } from './profile-list.decorator';
import { ProfileText } from './profile-text.decorator';

const L = PROFILE_LIMITS;

/**
 * Remplacement complet du parcours (ADR-0023 §2) : les huit clés de contenu et la `version` lue.
 * L'ordre des listes est l'ordre d'affichage.
 */
export class UpdateProfileDto {
  @ApiProperty({
    minimum: 1,
    description: 'Version lue avant édition (409 si elle a changé)',
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ type: ProfileBiographyDto })
  @ProfileSection(() => ProfileBiographyDto)
  biography!: ProfileBiographyDto;

  @ApiProperty({ type: [ProfileHighlightDto] })
  @ProfileItemList(L.highlight.items, () => ProfileHighlightDto)
  highlights!: ProfileHighlightDto[];

  @ApiProperty({ maxLength: L.sectionSummary })
  @ProfileText(L.sectionSummary)
  workSummary!: string;

  @ApiProperty({ type: [ProfileWhatIDoDto] })
  @ProfileItemList(L.whatIDo.items, () => ProfileWhatIDoDto)
  whatIDo!: ProfileWhatIDoDto[];

  @ApiProperty({ type: [ProfileTechnologyDto] })
  @ProfileItemList(L.technology.items, () => ProfileTechnologyDto)
  technologies!: ProfileTechnologyDto[];

  @ApiProperty({ maxLength: L.sectionSummary })
  @ProfileText(L.sectionSummary)
  diplomasSummary!: string;

  @ApiProperty({ type: [ProfileDiplomaDto] })
  @ProfileItemList(L.diploma.items, () => ProfileDiplomaDto)
  diplomas!: ProfileDiplomaDto[];

  @ApiProperty({ type: ProfileMotivationDto })
  @ProfileSection(() => ProfileMotivationDto)
  motivation!: ProfileMotivationDto;
}

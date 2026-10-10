import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, ValidateBy } from 'class-validator';

/** Balise ou commentaire HTML : `<` suivi d'une lettre, de `/`, `!` ou `?`. « a < b » reste du texte. */
const MARKUP = /<[a-zA-Z/!?]/;

type EachOption = { readonly each?: boolean };

/**
 * Texte éditorial du parcours : chaîne non blanche, bornée, sans balisage. Le front l'interpole en
 * texte (jamais en HTML), mais le document est du contenu, pas un gabarit : un balisage est une
 * erreur de saisie ou une tentative, refusée à la frontière.
 */
export function ProfileText(
  max: number,
  { each = false }: EachOption = {},
): PropertyDecorator {
  return applyDecorators(
    IsString({ each }),
    ValidateBy(
      {
        name: 'isNotBlank',
        validator: {
          validate: (value: unknown) =>
            typeof value === 'string' && value.trim().length > 0,
          defaultMessage: () => '$property must not be blank',
        },
      },
      { each },
    ),
    MaxLength(max, { each }),
    ValidateBy(
      {
        name: 'noMarkup',
        validator: {
          validate: (value: unknown) =>
            typeof value !== 'string' || !MARKUP.test(value),
          defaultMessage: () => '$property must not contain HTML markup',
        },
      },
      { each },
    ),
  );
}

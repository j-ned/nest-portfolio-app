// Barrel central. Chaque module métier ajoute son schéma ici.
import * as users from './users';
import * as profile from './profile';
import * as hero from './hero';
import * as socialLinks from './social-links';
import * as diplomas from './diplomas';
import * as technologies from './technologies';
import * as expertises from './expertises';
import * as servicePricing from './service-pricing';
import * as projects from './projects';

export * from './users';
export * from './profile';
export * from './hero';
export * from './social-links';
export * from './diplomas';
export * from './technologies';
export * from './expertises';
export * from './service-pricing';
export * from './projects';

export const schema = {
  ...users,
  ...profile,
  ...hero,
  ...socialLinks,
  ...diplomas,
  ...technologies,
  ...expertises,
  ...servicePricing,
  ...projects,
} as const;

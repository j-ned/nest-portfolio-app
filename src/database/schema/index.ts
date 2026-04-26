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
import * as contactMessages from './contact-messages';
import * as bookings from './bookings';
import * as cvFiles from './cv-files';

export * from './users';
export * from './profile';
export * from './hero';
export * from './social-links';
export * from './diplomas';
export * from './technologies';
export * from './expertises';
export * from './service-pricing';
export * from './projects';
export * from './contact-messages';
export * from './bookings';
export * from './cv-files';

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
  ...contactMessages,
  ...bookings,
  ...cvFiles,
} as const;

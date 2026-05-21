// Barrel central. Chaque module métier ajoute son schéma ici.
import * as users from './users';
import * as profile from './profile';
import * as projects from './projects';
import * as contactMessages from './contact-messages';
import * as cvFiles from './cv-files';
import * as analytics from './analytics';

export * from './users';
export * from './profile';
export * from './projects';
export * from './contact-messages';
export * from './cv-files';
export * from './analytics';

export const schema = {
  ...users,
  ...profile,
  ...projects,
  ...contactMessages,
  ...cvFiles,
  ...analytics,
} as const;

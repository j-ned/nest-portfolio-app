// Barrel central. Chaque module métier ajoute son schéma ici.
import * as users from './users';
import * as projects from './projects';
import * as projectImages from './project-images';
import * as contactMessages from './contact-messages';
import * as cvFiles from './cv-files';
import * as analytics from './analytics';
import * as blogPosts from './blog-posts';

export * from './users';
export * from './projects';
export * from './project-images';
export * from './contact-messages';
export * from './cv-files';
export * from './analytics';
export * from './blog-posts';

export const schema = {
  ...users,
  ...projects,
  ...projectImages,
  ...contactMessages,
  ...cvFiles,
  ...analytics,
  ...blogPosts,
} as const;

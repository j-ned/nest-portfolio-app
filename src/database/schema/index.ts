// Barrel central. Chaque module métier ajoute son schéma ici.
import * as users from './users';

export * from './users';

export const schema = {
  ...users,
} as const;

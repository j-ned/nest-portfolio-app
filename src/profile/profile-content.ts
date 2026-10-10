/**
 * Contenu éditable de la page Parcours (`/about`, spec 021, ADR-0023) : un document unique, les
 * listes dans l'ordre d'affichage. Chaque élément de liste porte un `id` UUID stable généré par le
 * client à l'ajout. L'identité (phrase `journey`, nom, ville, réseaux) reste dans le code du front.
 */
export type ProfileBiography = {
  readonly title: string;
  readonly summary: string;
  readonly leadEmphasis: string;
  readonly paragraphs: readonly string[];
};

export type ProfileTitledItem = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
};

export type ProfileTechnology = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly icon: string;
};

export type ProfileDiploma = {
  readonly id: string;
  readonly title: string;
  readonly provider: string;
  readonly level: string;
  readonly shortDescription: string;
  readonly skills: readonly string[];
};

export type ProfileMotivation = {
  readonly title: string;
  readonly statement: string;
  readonly description: string;
};

export type ProfileContent = {
  readonly biography: ProfileBiography;
  readonly highlights: readonly ProfileTitledItem[];
  readonly workSummary: string;
  readonly whatIDo: readonly ProfileTitledItem[];
  readonly technologies: readonly ProfileTechnology[];
  readonly diplomasSummary: string;
  readonly diplomas: readonly ProfileDiploma[];
  readonly motivation: ProfileMotivation;
};

/** Réponse de `GET /api/profile` : le contenu à plat, sa version et l'URL du portrait (`null` = portrait par défaut). */
export type ProfileDocument = ProfileContent & {
  readonly version: number;
  readonly updatedAt: Date;
  readonly portrait: string | null;
};

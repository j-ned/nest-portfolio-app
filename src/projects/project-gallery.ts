import type { Project } from '../database/schema/projects';
import type { ProjectImage } from '../database/schema/project-images';

/** Plafonds calibrés pour un seul administrateur et 3 à 5 captures visées (spec 011, arbitrage 5). */
export const PROJECT_GALLERY_MAX = 12;
export const PROJECT_IMAGE_ALT_MAX = 300;

export type ProjectImageResponse = {
  readonly id: string;
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly order: number;
};

export type ProjectResponse = Project & {
  readonly gallery: readonly ProjectImageResponse[];
};

/** Forme publique d'une capture : URL publique à la place de la clé S3, jamais exposée. */
export function toImageResponse(
  row: ProjectImage,
  toUrl: (key: string) => string,
): ProjectImageResponse {
  return {
    id: row.id,
    url: toUrl(row.key),
    alt: row.alt,
    width: row.width,
    height: row.height,
    order: row.order,
  };
}

/** Ordre d'affichage : `order`, puis date d'ajout pour départager deux captures au même rang. */
const byDisplayOrder = (a: ProjectImage, b: ProjectImage): number =>
  a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime();

/**
 * Regroupe les captures par projet, triées, avec une URL publique à la place de la clé S3.
 * Un projet sans capture n'a pas d'entrée : l'appelant lui donne `[]`.
 */
export function groupGalleryByProject(
  rows: readonly ProjectImage[],
  toUrl: (key: string) => string,
): ReadonlyMap<string, readonly ProjectImageResponse[]> {
  const gallery = new Map<string, ProjectImageResponse[]>();
  for (const row of [...rows].sort(byDisplayOrder)) {
    gallery.set(row.projectId, [
      ...(gallery.get(row.projectId) ?? []),
      toImageResponse(row, toUrl),
    ]);
  }
  return gallery;
}

/** Rang d'une nouvelle capture : après la dernière, même si les rangs existants ont des trous. */
export function nextGalleryOrder(
  rows: readonly Pick<ProjectImage, 'order'>[],
): number {
  return rows.reduce((max, row) => Math.max(max, row.order + 1), 0);
}

/**
 * Le réordonnancement exige la liste exacte des captures : aucune manquante, aucune en trop,
 * aucun doublon. Sinon une capture ajoutée entre-temps perdrait silencieusement son rang.
 */
export function isPermutationOf(
  currentIds: readonly string[],
  requestedIds: readonly string[],
): boolean {
  const requested = new Set(requestedIds);
  return (
    requested.size === requestedIds.length &&
    requestedIds.length === currentIds.length &&
    currentIds.every((id) => requested.has(id))
  );
}

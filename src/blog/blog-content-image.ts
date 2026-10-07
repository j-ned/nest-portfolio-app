/**
 * Images du corps des articles (ADR-0015 de la spec 016 du front) : aucune ligne en base, l'objet
 * S3 est adressé par le Markdown qui le cite. Les dimensions intrinsèques sont dans la clé, le
 * renderer Markdown du front les relit pour poser `width`/`height` (pas de CLS).
 */
export const CONTENT_IMAGE_PREFIX = 'blog-content/';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `blog-content/<uuid>-<sha8>-<largeur>x<hauteur>.avif`, seul format qu'on accepte de supprimer. */
const KEY_PATTERN = `${CONTENT_IMAGE_PREFIX}${UUID}-[0-9a-f]{8}-[1-9]\\d*x[1-9]\\d*\\.avif`;
const KEY = new RegExp(`^${KEY_PATTERN}$`);

/**
 * Clé citée par une URL du proxy public (`…/storage/portfolio-storage/<clé>`), quelle que soit sa
 * base : absolue de prod, `/api/storage/…` en développement, `/storage/…` relative. Le format de
 * clé est strict : seule une clé produite par `contentImageKey` peut être supprimée à partir d'un
 * Markdown (jamais une couverture, un CV, une carte de partage ni un chemin bricolé).
 */
const CITED_KEY = new RegExp(
  `/storage/portfolio-storage/(${KEY_PATTERN})(?![\\w.-])`,
  'g',
);

/** `blog-content/<uuid>-<sha8>-<largeur>x<hauteur>.avif` */
export function contentImageKey(
  id: string,
  hash: string,
  width: number,
  height: number,
): string {
  return `${CONTENT_IMAGE_PREFIX}${id}-${hash}-${width}x${height}.avif`;
}

/** Clés d'images du corps citées par un Markdown, dédoublonnées, dans l'ordre d'apparition. */
export function contentImageKeysIn(markdown: string): string[] {
  return [...new Set(Array.from(markdown.matchAll(CITED_KEY), (m) => m[1]))];
}

/** Vrai si `key` a exactement le format d'une image du corps produite par `contentImageKey`. */
export function isContentImageKey(key: string): boolean {
  return KEY.test(key);
}

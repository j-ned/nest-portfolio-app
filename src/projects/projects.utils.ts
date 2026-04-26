export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (NFD form)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const MIME_TO_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
};

export function isUniqueViolation(err: unknown, columnHint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  if (code !== '23505') return false;
  if (!columnHint) return true;
  const constraint =
    (err as { constraint_name?: string }).constraint_name ?? '';
  return constraint.includes(columnHint);
}

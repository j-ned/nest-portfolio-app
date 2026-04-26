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
  // Walk the error cause chain (Drizzle wraps the raw pg error in a
  // DrizzleQueryError whose `.cause` holds the original PostgresError).
  let current: unknown = err;
  let depth = 0;
  while (current !== null && typeof current === 'object' && depth < 5) {
    const obj = current as {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (obj.code === '23505') {
      if (!columnHint) return true;
      const constraint = obj.constraint_name ?? '';
      return constraint.includes(columnHint);
    }
    current = obj.cause;
    depth++;
  }
  return false;
}

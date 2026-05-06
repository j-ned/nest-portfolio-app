import { readFileSync } from 'node:fs';

export function renderTemplate(
  html: string,
  variables: Record<string, string>,
): string {
  let result = html;
  for (const [key, value] of Object.entries(variables)) {
    // Function form disables special $-sequence interpretation in `value`
    // (e.g., a value of "$&" would otherwise be interpreted as "matched text").
    result = result.replaceAll(`{{${key}}}`, () => value);
  }
  return result;
}

const templateCache = new Map<string, string>();

export function loadTemplate(absolutePath: string): string {
  let cached = templateCache.get(absolutePath);
  if (cached === undefined) {
    cached = readFileSync(absolutePath, 'utf-8');
    templateCache.set(absolutePath, cached);
  }
  return cached;
}

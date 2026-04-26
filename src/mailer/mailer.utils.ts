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

export function loadTemplate(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf-8');
}

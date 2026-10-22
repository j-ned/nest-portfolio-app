import { readFileSync } from 'node:fs';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Remplace chaque `{{key}}` par sa valeur, échappée pour un contexte HTML (texte et attributs
 * entre guillemets doubles). Les variables viennent du formulaire de contact public : sans
 * échappement, un visiteur injecte un lien de phishing ou un pixel de tracking dans le mail admin.
 */
export function renderTemplate(
  html: string,
  variables: Record<string, string>,
): string {
  let result = html;
  for (const [key, value] of Object.entries(variables)) {
    const safe = escapeHtml(value);
    // Function form disables special $-sequence interpretation in `value`
    // (e.g., a value of "$&" would otherwise be interpreted as "matched text").
    result = result.replaceAll(`{{${key}}}`, () => safe);
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

const maskOneAddress = (address: string): string => {
  const at = address.lastIndexOf('@');
  if (at === -1) return '***';
  return `${address.slice(0, Math.min(at, 1))}***${address.slice(at)}`;
};

/** `camille@example.com` → `c***@example.com` : assez pour diagnostiquer un domaine, pas pour identifier. */
export function maskEmail(recipients: string): string {
  return recipients
    .split(',')
    .map((address) => maskOneAddress(address.trim()))
    .join(', ');
}

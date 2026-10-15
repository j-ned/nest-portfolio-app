import type { ErrorEvent } from '@sentry/nestjs';
import { SENSITIVE_BODY_FIELDS, redactUrl } from './log-redact';

const FILTERED = '[Filtered]';
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(SENSITIVE_BODY_FIELDS);

const scrubValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      SENSITIVE_KEYS.has(key) ? FILTERED : scrubValue(inner),
    ]),
  );
};

/**
 * Sentry joint le corps des requêtes entrantes aux événements : une chaîne qui n'est pas du JSON
 * (formulaire encodé, texte) ne peut pas être filtrée champ par champ, elle part donc masquée.
 */
const scrubBody = (data: unknown): unknown => {
  if (typeof data !== 'string') return scrubValue(data);
  if (data === '') return data;
  try {
    return JSON.stringify(scrubValue(JSON.parse(data)));
  } catch {
    return FILTERED;
  }
};

/**
 * Retire cookies, en-têtes d'authentification et champs sensibles du corps, masque le jeton du flux
 * d'agenda (URL, query string, transaction), sans muter l'événement.
 */
export function sentryBeforeSend(event: ErrorEvent): ErrorEvent {
  const { request, transaction } = event;
  const named =
    transaction === undefined
      ? event
      : { ...event, transaction: redactUrl(transaction) };
  if (!request) return named;

  const scrubbed: ErrorEvent['request'] = { ...request };
  delete scrubbed.cookies;
  if (request.headers) {
    const headers = { ...request.headers };
    delete headers['authorization'];
    delete headers['cookie'];
    scrubbed.headers = headers;
  }
  if (request.data !== undefined) scrubbed.data = scrubBody(request.data);
  const url = redactUrl(request.url);
  if (url !== request.url) {
    scrubbed.url = url;
    delete scrubbed.query_string;
  }
  return { ...named, request: scrubbed };
}

/** Requêtes entrantes jamais tracées : la sonde de santé et le flux d'agenda (le jeton est dans le chemin). */
export function isUntracedIncomingRequest(url: string): boolean {
  return url.startsWith('/api/health') || url.startsWith('/api/booking/feed/');
}

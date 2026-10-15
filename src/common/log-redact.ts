/**
 * Champs du corps de requête jamais transmis tels quels hors du processus : secrets
 * d'authentification et coordonnées du visiteur (réservation de rendez-vous, contact).
 * Source unique des masques pino (`LOG_REDACT_PATHS`) et du filtre Sentry (`sentryBeforeSend`).
 */
export const SENSITIVE_BODY_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'code',
  'token',
  'refreshToken',
  'jwt',
  'name',
  'email',
  'phone',
  'company',
  'message',
  'website',
] as const;

/** Chemins masqués par pino dans les logs de requêtes (secrets et données personnelles). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  ...SENSITIVE_BODY_FIELDS.map((field) => `req.body.${field}` as const),
  // Le cookie de session (JWT complet) était écrit dans les logs à chaque login.
  'res.headers["set-cookie"]',
] as const;

/**
 * Le segment qui suit `/api/booking/feed/` est le jeton du flux d'agenda (un secret) : il est masqué avec
 * tout ce qui le suit (extension, query string). Non ancrée, la recherche couvre aussi l'URL absolue et le
 * nom de transaction (`GET /api/…`) que Sentry construit.
 */
const FEED_PATH = /(\/api\/booking\/feed\/)[\s\S]*$/;

export function redactUrl(url: string): string;
export function redactUrl(url: string | undefined): string | undefined;
export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(FEED_PATH, '$1[Filtered]');
}

export type SerializedRequest = { id?: string; method?: string; url?: string };

/** Sérialiseur pino des requêtes : ni en-têtes ni corps, URL passée à `redactUrl`. */
export function serializeRequest(req: SerializedRequest): SerializedRequest {
  return { id: req.id, method: req.method, url: redactUrl(req.url) };
}

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

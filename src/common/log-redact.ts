/** Chemins masqués par pino dans les logs de requêtes (secrets et données personnelles). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.code',
  'req.body.token',
  'req.body.refreshToken',
  // Coordonnées du visiteur (réservation de rendez-vous, contact).
  'req.body.phone',
  'req.body.email',
  // Le cookie de session (JWT complet) était écrit dans les logs à chaque login.
  'res.headers["set-cookie"]',
] as const;

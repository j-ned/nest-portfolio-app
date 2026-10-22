import pino from 'pino';

/**
 * Champs du corps de requête jamais transmis tels quels hors du processus : secrets
 * d'authentification et coordonnées du visiteur (formulaire de contact).
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
 * nom de transaction (`GET /api/…`) que Sentry construit ; insensible à la casse comme le routage Express.
 */
const FEED_PATH = /(\/api\/booking\/feed\/)[\s\S]*$/i;

/**
 * Forme du jeton (43 caractères base64url suivis de `.ics`, point encodé compris), masquée où qu'elle
 * soit : chemins que `FEED_PATH` ne reconnaît pas (`//`, segment encodé, route mal formée).
 */
const FEED_TOKEN_SEGMENT = /[A-Za-z0-9_-]{43}(?:\.|%2e)ics/gi;

const FILTERED = '[Filtered]';

export function redactUrl(url: string): string;
export function redactUrl(url: string | undefined): string | undefined;
export function redactUrl(url: string | undefined): string | undefined {
  return url
    ?.replace(FEED_PATH, `$1${FILTERED}`)
    .replace(FEED_TOKEN_SEGMENT, FILTERED);
}

/** Coupe la query string et le fragment : ils peuvent porter un e-mail, un jeton ou un terme recherché. */
export const stripQueryAndFragment = (url: string): string =>
  url.split(/[?#]/, 1)[0];

type SerializedRequest = { id?: string; method?: string; url?: string };

/**
 * Sérialiseur pino des requêtes : ni en-têtes (`authorization`, `cookie`, `x-forwarded-for`), ni IP
 * (`remoteAddress`), ni corps, ni query string ; le chemin passe à `redactUrl`.
 */
export function serializeRequest(req: SerializedRequest): SerializedRequest {
  return {
    id: req.id,
    method: req.method,
    url: req.url && redactUrl(stripQueryAndFragment(req.url)),
  };
}

/**
 * `DrizzleQueryError` écrit les paramètres liés (valeurs saisies : nom, e-mail, message) après
 * `\nparams: ` dans son message, donc dans sa pile. Dans un message, ils courent jusqu'à la fin ; dans
 * une pile, jusqu'à la première frame (`\n    at `), pour garder la trace d'appel.
 */
const QUERY_PARAMS = {
  message: /\nparams: [\s\S]*$/,
  stack: /\nparams: [\s\S]*?(?=\n {4}at |$)/g,
} as const;

/** Masque les paramètres liés d'une erreur de requête SQL dans un message (défaut) ou une pile. */
export const redactQueryParams = (
  text: string,
  kind: keyof typeof QUERY_PARAMS = 'message',
): string => text.replace(QUERY_PARAMS[kind], `\nparams: ${FILTERED}`);

/**
 * Champs d'erreur porteurs de valeurs : `params` (Drizzle), `parameters` (postgres.js en mode debug),
 * `detail` (Postgres : « Key (email)=(…) already exists », « Failing row contains (…) »).
 */
const ERROR_VALUE_FIELDS = ['params', 'parameters', 'detail'] as const;

type SerializedError = Record<string, unknown> & {
  message?: unknown;
  stack?: unknown;
};

const scrubSerializedError = (err: SerializedError): SerializedError => {
  // Paramètres connus (DrizzleQueryError) : remplacement exact, qui garde le message de la cause que
  // pino ajoute après (`params: …: relation "x" does not exist`) et résiste à une valeur saisie imitant
  // une frame. Sinon (pile recopiée dans une autre erreur), l'expression sert de filet.
  const exact = Array.isArray(err.params)
    ? `\nparams: ${String(err.params)}`
    : undefined;
  const scrub = (text: unknown, kind: 'message' | 'stack'): unknown => {
    if (typeof text !== 'string') return text;
    return exact
      ? text.split(exact).join(`\nparams: ${FILTERED}`)
      : redactQueryParams(text, kind);
  };
  const scrubbed: SerializedError = {
    ...err,
    message: scrub(err.message, 'message'),
    stack: scrub(err.stack, 'stack'),
  };
  for (const field of ERROR_VALUE_FIELDS) {
    if (scrubbed[field] !== undefined) scrubbed[field] = FILTERED;
  }
  return scrubbed;
};

/**
 * Sérialiseur pino des erreurs (`err`) : type, requête SQL, code Postgres et frames gardés, valeurs
 * liées masquées dans le message et la pile (causes comprises, que pino y concatène). pino-http lui passe l'erreur déjà sérialisée
 * (`wrapErrorSerializer`) ; une `Error` brute (pino seul) est d'abord sérialisée de la même façon.
 */
export function serializeError(err: unknown): SerializedError {
  const serialized =
    err instanceof Error
      ? (pino.stdSerializers.err(err) as unknown as SerializedError)
      : (err as SerializedError);
  return scrubSerializedError(serialized);
}

/**
 * Arguments d'un appel de log (hook `logMethod`) : un message chaîne qui recopie `err.message`
 * (`track failed: ${e.message}`) perd ses paramètres liés.
 */
export const redactLogArguments = (args: readonly unknown[]): unknown[] =>
  args.map((arg) => (typeof arg === 'string' ? redactQueryParams(arg) : arg));

import type { ErrorEvent, Event } from '@sentry/nestjs';
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

/** En-têtes porteurs de secrets, comparés en minuscules : Node les normalise, un événement forgé non. */
const SECRET_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);

/** Coupe la query string et le fragment : ils peuvent porter un e-mail, un jeton ou un terme recherché. */
const stripQueryAndFragment = (url: string): string => url.split(/[?#]/, 1)[0];

/**
 * `DrizzleQueryError` écrit les paramètres liés (valeurs saisies : nom, e-mail, message) après
 * `\nparams: ` dans son message ; `dataCollection.databaseQueryData` ne touche pas aux messages d'erreur.
 */
const QUERY_PARAMS = /\nparams: [\s\S]*$/;

const scrubExceptionValues = (
  exception: ErrorEvent['exception'],
): ErrorEvent['exception'] =>
  exception?.values && {
    ...exception,
    values: exception.values.map((value) =>
      value.value === undefined
        ? value
        : {
            ...value,
            value: value.value.replace(QUERY_PARAMS, `\nparams: ${FILTERED}`),
          },
    ),
  };

/**
 * Filet après `dataCollection` (fermé dans `instrument.ts`) : retire l'IP de l'utilisateur, les cookies,
 * les en-têtes d'authentification et de cookies (toute casse), la query string et le fragment de l'URL,
 * les champs sensibles du corps, les paramètres liés des erreurs de requête SQL, et masque le jeton du flux d'agenda (URL, transaction), sans muter
 * l'événement.
 */
export function sentryBeforeSend(event: ErrorEvent): ErrorEvent {
  const { exception, request, transaction, user } = event;
  const named: ErrorEvent = { ...event };
  if (exception?.values) named.exception = scrubExceptionValues(exception);
  if (transaction !== undefined) named.transaction = redactUrl(transaction);
  if (user && 'ip_address' in user) {
    const anonymous = { ...user };
    delete anonymous.ip_address;
    named.user = anonymous;
  }
  if (!request) return named;

  const scrubbed: ErrorEvent['request'] = { ...request };
  delete scrubbed.cookies;
  delete scrubbed.query_string;
  if (request.headers) {
    scrubbed.headers = Object.fromEntries(
      Object.entries(request.headers).filter(
        ([name]) => !SECRET_HEADERS.has(name.toLowerCase()),
      ),
    );
  }
  if (request.data !== undefined) scrubbed.data = scrubBody(request.data);
  if (request.url !== undefined) {
    scrubbed.url = redactUrl(stripQueryAndFragment(request.url));
  }
  return { ...named, request: scrubbed };
}

type TransactionEvent = Event & { type: 'transaction' };

/** Vrai si l'URL désigne le flux d'agenda (ou en porte le jeton) : `redactUrl` la modifierait. */
const isFeedUrl = (url: unknown): boolean =>
  typeof url === 'string' && redactUrl(url) !== url;

/** Clés de `contexts.trace.data` où l'instrumentation HTTP et Nest écrit l'URL de la requête. */
const TRACE_URL_KEYS = [
  'http.url',
  'url',
  'url.full',
  'url.path',
  'http.target',
] as const;

/** Passe chaque valeur chaîne de premier niveau (requête, données de span) à `redactUrl`. */
const redactData = <D extends object>(data: D): D =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string' ? redactUrl(value) : value,
    ]),
  ) as D;

/**
 * Écarte toute transaction du flux d'agenda : selon le chemin, Sentry l'ouvre sur le span de Nest
 * (`request_context.nestjs`), sur `http.server` ou sur le filtre d'exceptions, et chacune porte l'URL
 * concrète, donc le jeton. Les autres transactions passent, toute URL du flux restante masquée dans les
 * champs sérialisés (nom, requête, données de trace, spans). Le parcours est borné à ces champs :
 * `sdkProcessingMetadata` porte les scopes, circulaires, et n'est pas envoyé.
 */
export function sentryBeforeSendTransaction(
  event: TransactionEvent,
): TransactionEvent | null {
  const { request, contexts, spans, transaction } = event;
  const trace = contexts?.trace;
  const traceData = trace?.data ?? {};
  const designatesFeed =
    isFeedUrl(transaction) ||
    isFeedUrl(request?.url) ||
    TRACE_URL_KEYS.some((key) => isFeedUrl(traceData[key]));
  if (designatesFeed) return null;

  return {
    ...event,
    ...(transaction !== undefined && { transaction: redactUrl(transaction) }),
    ...(request && { request: redactData(request) }),
    ...(trace?.data && {
      contexts: {
        ...contexts,
        trace: { ...trace, data: redactData(trace.data) },
      },
    }),
    ...(spans && {
      spans: spans.map((span) => ({
        ...span,
        description: redactUrl(span.description),
        data: redactData(span.data),
      })),
    }),
  };
}

/**
 * Requêtes entrantes jamais tracées : la sonde de santé et le flux d'agenda (le jeton est dans le chemin),
 * quelle que soit la casse du chemin.
 */
export function isUntracedIncomingRequest(url: string): boolean {
  return url.startsWith('/api/health') || isFeedUrl(url);
}

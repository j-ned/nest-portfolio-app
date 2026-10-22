import {
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { redactUrl } from '../log-redact';

type ErrorPayload = {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
};

type ClientError = { status: number; error: string; message: string };

/**
 * Erreurs au format `http-errors` levées avant Nest (body-parser : corps trop gros, encodage non
 * supporté, JSON tronqué) : statut dans `status` ou `statusCode`. Seules les 4xx sont rendues telles
 * quelles ; le message n'est repris que si l'erreur se déclare exposable (`expose`), sinon c'est
 * l'intitulé du statut.
 */
function toClientError(exception: unknown): ClientError | undefined {
  if (!(exception instanceof Error)) return undefined;
  const { status, statusCode, expose } = exception as Error & {
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  };
  const code = status ?? statusCode;
  if (typeof code !== 'number' || code < 400 || code > 499) return undefined;
  const error = STATUS_CODES[code] ?? 'Error';
  return {
    status: code,
    error,
    message: expose === true ? exception.message : error,
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const clientError =
      exception instanceof HttpException ? undefined : toClientError(exception);

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (clientError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);

    const baseError =
      exception instanceof HttpException
        ? exception.getResponse()
        : (clientError ?? {
            message: 'Internal server error',
            error: 'Internal Server Error',
          });

    const errorBody =
      typeof baseError === 'string'
        ? { message: baseError, error: HttpStatus[status] ?? 'Error' }
        : (baseError as { message?: string | string[]; error?: string });

    // `originalUrl` : URL complète, préfixe global compris. Depuis NestJS 12, le gestionnaire
    // des routes inconnues est monté sous le préfixe et Express y retire `/api` de `req.url`.
    const path = redactUrl(req.originalUrl ?? req.url);
    const payload: ErrorPayload = {
      statusCode: status,
      error: errorBody.error ?? HttpStatus[status] ?? 'Error',
      message: errorBody.message ?? 'Unexpected error',
      path,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        { err: exception, path, method: req.method },
        `Unhandled ${status} on ${req.method} ${path}`,
      );
    }
    res.status(status).json(payload);
  }
}

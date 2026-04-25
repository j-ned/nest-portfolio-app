import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorPayload {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const baseError =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error', error: 'Internal Server Error' };

    const errorBody =
      typeof baseError === 'string'
        ? { message: baseError, error: HttpStatus[status] ?? 'Error' }
        : (baseError as { message?: string | string[]; error?: string });

    const payload: ErrorPayload = {
      statusCode: status,
      error: errorBody.error ?? HttpStatus[status] ?? 'Error',
      message: errorBody.message ?? 'Unexpected error',
      path: req.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        { err: exception, path: req.url, method: req.method },
        `Unhandled ${status} on ${req.method} ${req.url}`,
      );
    }
    res.status(status).json(payload);
  }
}

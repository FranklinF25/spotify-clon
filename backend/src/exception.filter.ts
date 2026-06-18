import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

import { type ErrorCode, DomainError } from './shared/errors/domain-error';

/**
 * Global exception filter that normalizes every error into the DESIGN §4.3
 * envelope: `{ error: { code, message, details? } }`.
 *
 * - {@link DomainError} subclasses map to their pinned status/code/details.
 * - NestJS {@link HttpException}s (e.g. framework-thrown 404s) are mapped to a
 *   matching code via {@link codeForStatus}.
 * - Anything else becomes a 500 INTERNAL_ERROR with a generic message (the
 *   original error is never leaked to the client).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      response.status(exception.status).json({ error: exception.toJSON() });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = this.extractMessage(body, exception);
      response.status(status).json({ error: { code: this.codeForStatus(status), message } });
      return;
    }

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }

  private extractMessage(body: unknown, exception: HttpException): string {
    if (typeof body === 'string') {
      return body;
    }
    const message = (body as { message?: string | string[] }).message;
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    return typeof message === 'string' ? message : exception.message;
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}

import { Injectable, type LoggerService } from '@nestjs/common';
import pino, { type Logger, type LoggerOptions } from 'pino';

import { getCurrentRequestId } from './request-context';

/**
 * Builds the underlying pino logger used by {@link AppLogger}.
 * Exposed so tests (and bootstrap) can construct loggers with custom
 * destinations / levels.
 *
 * Registers `pino.stdSerializers.err` so any `err` field carried on a log line
 * (pino convention) serializes with `message`, `stack`, and `type` instead of
 * the `{}` placeholder `JSON.stringify` produces for non-enumerable Error
 * properties.
 */
export function createBaseLogger(level: string = 'info', options: LoggerOptions = {}): Logger {
  return pino({
    level,
    serializers: { err: pino.stdSerializers.err },
    ...options,
  });
}

/**
 * NestJS LoggerService backed by pino.
 *
 * Every call resolves the current requestId from the AsyncLocalStorage
 * context and, when present, writes the log line on a child logger so the
 * `requestId` field is attached (spec: "every log line for that request
 * carries a requestId").
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(logger?: Logger, level: string = 'info') {
    this.logger = logger ?? createBaseLogger(level);
  }

  private contextual(): Logger {
    const requestId = getCurrentRequestId();
    return requestId ? this.logger.child({ requestId }) : this.logger;
  }

  log(message: unknown, ...optional: unknown[]): void {
    this.contextual().info({ msg: message, optional });
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.contextual().error({ msg: message, optional });
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.contextual().warn({ msg: message, optional });
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.contextual().debug({ msg: message, optional });
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.contextual().trace({ msg: message, optional });
  }
}

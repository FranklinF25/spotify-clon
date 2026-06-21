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

  /**
   * Builds the pino merging object for a string-first call.
   *
   * Structured keys (plain objects) and Errors are HOISTED to the top level
   * so pino serializers fire on them — pino only invokes serializers for
   * top-level keys of the merging object, never nested ones. A call like
   * `error('Unhandled exception', { err, path })` therefore produces
   * `{ msg, err, path }`, where `err` is picked up by
   * `pino.stdSerializers.err` and serialized with `message`/`stack`/`type`.
   *
   * Primitive args (strings, numbers, arrays, ...) are still collected under
   * `optional` as an escape hatch for ad-hoc context that doesn't fit a
   * structured key.
   */
  private buildMerge(message: unknown, optional: unknown[]): Record<string, unknown> {
    const obj: Record<string, unknown> = { msg: message };
    const rest: unknown[] = [];
    for (const arg of optional) {
      if (arg instanceof Error) {
        obj.err = arg;
      } else if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        Object.assign(obj, arg);
      } else {
        rest.push(arg);
      }
    }
    if (rest.length > 0) obj.optional = rest;
    return obj;
  }

  log(message: unknown, ...optional: unknown[]): void {
    this.contextual().info(this.buildMerge(message, optional));
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.contextual().error(this.buildMerge(message, optional));
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.contextual().warn(this.buildMerge(message, optional));
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.contextual().debug(this.buildMerge(message, optional));
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.contextual().trace(this.buildMerge(message, optional));
  }
}

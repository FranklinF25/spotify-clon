import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import pino from 'pino';

import { AppLogger, createBaseLogger } from './logger';
import { RequestIdMiddleware } from './request-id.middleware';
import { requestContextStorage } from './request-context';

function capturingLogger(sink: string[]): pino.Logger {
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      sink.push(chunk.toString());
      callback();
    },
  });
  return pino({ level: 'info' }, stream);
}

/**
 * Same as {@link capturingLogger} but registers `pino.stdSerializers.err`,
 * mirroring the production {@link createBaseLogger}. Used to prove that
 * `err` only serializes when it lands at the TOP LEVEL of the pino merging
 * object — pino runs serializers exclusively on top-level keys.
 */
function capturingLoggerWithSerializers(sink: string[]): pino.Logger {
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      sink.push(chunk.toString());
      callback();
    },
  });
  return pino(
    { level: 'info', serializers: { err: pino.stdSerializers.err } },
    stream,
  );
}

describe('RequestIdMiddleware', () => {
  it('honors an incoming x-request-id header and echoes it on the response', () => {
    const middleware = new RequestIdMiddleware();
    const req = { get: (_name: string) => 'incoming-id-42' } as never;
    const responseHeader: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string) => (responseHeader[name] = value) } as never;

    let nextCalled = false;
    middleware.use(req, res, () => {
      nextCalled = true;
    });

    expect((req as { requestId?: string }).requestId).toBe('incoming-id-42');
    expect(responseHeader['x-request-id']).toBe('incoming-id-42');
    expect(nextCalled).toBe(true);
  });

  it('rejects an incoming x-request-id with invalid characters and falls back to a fresh UUID', () => {
    const middleware = new RequestIdMiddleware();
    // CRLF injection attempt — must NOT pass through.
    const req = { get: (_name: string) => 'evil\r\nSet-Cookie: admin=1' } as never;
    const responseHeader: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string) => (responseHeader[name] = value) } as never;

    middleware.use(req, res, () => {
      /* next */
    });

    const generated = (req as { requestId?: string }).requestId;
    expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(generated).not.toContain('\r');
    expect(generated).not.toContain('\n');
    expect(responseHeader['x-request-id']).toBe(generated);
  });

  it('rejects an incoming x-request-id that exceeds 64 characters and falls back to a fresh UUID', () => {
    const middleware = new RequestIdMiddleware();
    const tooLong = 'a'.repeat(65);
    const req = { get: (_name: string) => tooLong } as never;
    const responseHeader: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string) => (responseHeader[name] = value) } as never;

    middleware.use(req, res, () => {
      /* next */
    });

    const generated = (req as { requestId?: string }).requestId;
    expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(generated).not.toBe(tooLong);
  });

  it('generates a uuid request id when the header is absent', () => {
    const middleware = new RequestIdMiddleware();
    const req = { get: () => undefined } as never;
    const responseHeader: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string) => (responseHeader[name] = value) } as never;

    middleware.use(req, res, () => {
      /* next */
    });

    const generated = (req as { requestId?: string }).requestId;
    expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(responseHeader['x-request-id']).toBe(generated);
  });
});

describe('AppLogger request correlation', () => {
  it('emits a requestId on every log line inside a request context', () => {
    const sink: string[] = [];
    const logger = new AppLogger(capturingLogger(sink));

    requestContextStorage.run({ requestId: 'r-correlated' }, () => {
      logger.log('hello world');
    });

    expect(sink).toHaveLength(1);
    const parsed = JSON.parse(sink[0] as string) as { requestId?: string; msg?: unknown };
    expect(parsed.requestId).toBe('r-correlated');
  });

  it('omits requestId when not inside a request context', () => {
    const sink: string[] = [];
    const logger = new AppLogger(capturingLogger(sink));

    logger.log('boot message');

    const parsed = JSON.parse(sink[0] as string) as { requestId?: string };
    expect(parsed.requestId).toBeUndefined();
  });

  it('createBaseLogger returns a usable pino logger', () => {
    const base = createBaseLogger('warn');
    expect(base.level).toBe('warn');
  });
});

describe('AppLogger structured-arg flattening (R3-1)', () => {
  // Regression: before R3-1, AppLogger.error(msg, ...optional) wrapped every
  // optional arg under `{ msg, optional: [...] }`. pino serializers ONLY run
  // on top-level keys of the merging object, so an `err` nested at
  // `optional[0].err` serialized to `{}` and the original error vanished
  // from the logs. The fix flattens structured keys (and Errors) to the top
  // level so `pino.stdSerializers.err` fires.

  it('hoists a `{ err, path }` arg to the top level so the err serializer fires', () => {
    const sink: string[] = [];
    const logger = new AppLogger(capturingLoggerWithSerializers(sink));

    logger.error('Unhandled exception', { err: new Error('boom'), path: '/x' });

    expect(sink).toHaveLength(1);
    const parsed = JSON.parse(sink[0] as string) as {
      msg?: string;
      err?: { message?: string; stack?: string; type?: string };
      path?: string;
      optional?: unknown[];
    };

    expect(parsed.msg).toBe('Unhandled exception');
    // If the serializer never fires, `err` serializes to `{}` and these fail.
    expect(parsed.err?.message).toBe('boom');
    expect(typeof parsed.err?.stack).toBe('string');
    expect(parsed.err?.stack).not.toBe('');
    expect(parsed.err?.type).toBe('Error');
    // Non-Error structured keys ride along at the top level too.
    expect(parsed.path).toBe('/x');
    // Nothing should be buried under the legacy `optional` array.
    expect(parsed.optional).toBeUndefined();
  });

  it('hoists a bare Error arg to top-level err so the serializer fires', () => {
    const sink: string[] = [];
    const logger = new AppLogger(capturingLoggerWithSerializers(sink));

    logger.error('failure', new Error('bare-boom'));

    const parsed = JSON.parse(sink[0] as string) as {
      err?: { message?: string; type?: string };
      optional?: unknown[];
    };
    expect(parsed.err?.message).toBe('bare-boom');
    expect(parsed.err?.type).toBe('Error');
    expect(parsed.optional).toBeUndefined();
  });

  it('keeps collecting primitive args under `optional` (escape hatch unchanged)', () => {
    const sink: string[] = [];
    const logger = new AppLogger(capturingLoggerWithSerializers(sink));

    logger.error('something happened', 'extra-context', 42);

    const parsed = JSON.parse(sink[0] as string) as {
      msg?: string;
      optional?: unknown[];
    };
    expect(parsed.msg).toBe('something happened');
    expect(parsed.optional).toEqual(['extra-context', 42]);
  });

  it('omits the optional key entirely when no primitive args are passed', () => {
    const sink: string[] = [];
    const logger = new AppLogger(capturingLoggerWithSerializers(sink));

    logger.warn('just a message');

    const parsed = JSON.parse(sink[0] as string) as {
      msg?: string;
      optional?: unknown[];
    };
    expect(parsed.msg).toBe('just a message');
    expect(parsed.optional).toBeUndefined();
  });
});

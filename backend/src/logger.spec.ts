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

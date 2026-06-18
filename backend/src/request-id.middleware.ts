import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { requestContextStorage } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Tags every incoming request with a `requestId`.
 *
 * - When the client sends an `x-request-id` header, that value is trusted
 *   (trimmed) so external callers can correlate their traces with ours.
 * - Otherwise a new UUIDv4 is generated.
 *
 * The resolved id is stored on `req.requestId`, echoed back on the response
 * `x-request-id` header, and propagated through {@link requestContextStorage}
 * so the logger emits it on every line for the request.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    req: Request & { requestId?: string },
    res: Response,
    next: NextFunction,
  ): void {
    const incoming = req.get(REQUEST_ID_HEADER)?.trim();
    const requestId = incoming && incoming.length > 0 ? incoming : randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    requestContextStorage.run({ requestId }, () => next());
  }
}

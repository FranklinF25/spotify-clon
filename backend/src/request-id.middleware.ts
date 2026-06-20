import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { requestContextStorage } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';
/**
 * Strict allow-list for incoming `x-request-id` values: URL-safe characters
 * (letters, digits, `-`, `_`), 1–64 chars long. Anything else — including CRLF
 * sequences that could enable log forging or response splitting — is rejected
 * and a fresh UUID is minted instead. The 64-char ceiling matches the common
 * traceparent / correlation-id length budget.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Tags every incoming request with a `requestId`.
 *
 * - When the client sends an `x-request-id` header that matches the strict
 *   allow-list, that value is trusted (trimmed) so external callers can
 *   correlate their traces with ours.
 * - When the header is missing OR contains characters outside the allow-list
 *   (or exceeds 64 chars), a new UUIDv4 is generated instead. This defeats
 *   log-forging and response-splitting attempts that smuggle `\r\n` or other
 *   control characters through the header value.
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
    const requestId =
      incoming !== undefined && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    requestContextStorage.run({ requestId }, () => next());
  }
}

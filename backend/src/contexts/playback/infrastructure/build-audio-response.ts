import type { Response } from 'express';

import type { StreamResult } from '../domain/types';

/**
 * Audio response header helpers (PB-PR2-04, REQ-PLAY-005).
 *
 * Pure helpers that mutate the Express `Response` object to set status and
 * headers for the three "audio" outcomes the stream endpoint emits:
 *   - 200 (full body)
 *   - 206 (partial body)
 *   - 416 (unsatisfiable range, empty body)
 *
 * The helpers do NOT touch the stream — Nest's `StreamableFile` handles
 * piping. They also do NOT throw; the controller chooses which helper to
 * call based on the use case outcome union.
 *
 * `buildAudioHeaders` narrows on `payload.result.kind` (the natural
 * StreamResult discriminant — R4 Judgment Day fix), NOT on `payload.status`:
 * TypeScript does NOT co-vary `status` with `kind`, so narrowing on
 * `status` would fail to typecheck `.total` / `.range` access. The caller
 * (the controller) guarantees the invariant: status 200 always pairs with
 * `kind: 'full'`, status 206 always pairs with `kind: 'partial'`.
 */

/**
 * Set headers for the 200 / 206 success paths.
 *
 * Both paths set `Accept-Ranges: bytes` (so RFC-compliant clients know they
 * may issue `Range` requests) and `Content-Type` forwarded from
 * `payload.result.contentType` — the MIME the storage adapter derived from
 * the resolved file extension (flac → audio/flac, mp3 → audio/mpeg, ...;
 * REQ-PLAY-005 content-type fix). The 200 path sets `Content-Length: total`;
 * the 206 path additionally sets `Content-Range: bytes start-end/total` and
 * `Content-Length: end - start + 1`.
 *
 * No `as any` casts and no runtime narrowing on `status` — the helper is
 * total over its declared `payload: { status: 200 | 206; result: StreamResult }`
 * type, with `result.kind` doing the variant discrimination.
 */
export function buildAudioHeaders(
  res: Response,
  payload: { status: 200 | 206; result: StreamResult },
): void {
  res.status(payload.status);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', payload.result.contentType);

  // Narrow on `result.kind` — see module docstring + R4 Judgment Day fix.
  if (payload.result.kind === 'full') {
    res.setHeader('Content-Length', payload.result.total);
    return;
  }

  // Partial — status 206 (caller-guaranteed invariant).
  const { start, end, total } = payload.result.range;
  res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  res.setHeader('Content-Length', end - start + 1);
}

/**
 * Set headers for the 416 unsatisfiable-range path.
 *
 * RFC 7233 §4.4: the response MUST include a `Content-Range` header with an
 * unsatisfied-range indicator (`bytes * slash total`) and SHOULD NOT include
 * a body. The client reads the unsatisfiable-range signal from the header,
 * not from a JSON envelope — this is why the 416 body is empty (Q5).
 */
export function buildUnsatisfiableHeaders(res: Response, total: number): void {
  res.status(416);
  res.setHeader('Content-Range', `bytes */${total}`);
  // No Content-Length / Content-Type — body is intentionally empty.
}

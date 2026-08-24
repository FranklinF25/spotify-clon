import { z } from 'zod';

import { UnprocessableEntityError } from '../../../../shared/errors/unprocessable-entity-error';

/**
 * Album id path-param guard (F6 — design §8.2, decision D6).
 *
 * One thin wrapper, mirroring the `validate-pagination.ts` shape: zod parse,
 * rethrow as the spec-pinned error. Applied uniformly on BOTH param handlers
 * (POST + DELETE `:albumId`) — one guard at one seam.
 *
 * REQ-L-002 pins **422** for the MALFORMED param (not 400): the library
 * write surface treats "not a resolvable album reference" uniformly — a
 * malformed UUID is a client bug, distinct from REQ-L-004's well-formed
 * idempotent-remove semantics. `UnprocessableEntityError` is reused from F5
 * verbatim; `GlobalExceptionFilter` maps it untouched (no shared-error
 * change in F6).
 */
const albumIdSchema = z.string().uuid();

export function parseAlbumIdParam(raw: string): string {
  const result = albumIdSchema.safeParse(raw);
  if (!result.success) {
    throw new UnprocessableEntityError('album', raw);
  }
  return result.data;
}

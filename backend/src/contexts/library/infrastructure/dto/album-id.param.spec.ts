import { describe, expect, it } from 'vitest';

import { UnprocessableEntityError } from '../../../../shared/errors/unprocessable-entity-error';
import { parseAlbumIdParam } from './album-id.param';

/**
 * `parseAlbumIdParam` unit specs (F6 — WORK-PR2-01, design §8.2 / D6).
 *
 * The guard is the uniform HTTP-edge seam for BOTH param handlers (POST +
 * DELETE): a malformed UUID param is a client bug and surfaces as 422
 * `UNPROCESSABLE_ENTITY` — NOT 400 (REQ-L-002 pins 422 for the malformed
 * param; the library write surface treats "not a resolvable album
 * reference" uniformly). Existence validation is deliberately NOT here —
 * that is `AddAlbumToLibraryUseCase`'s job.
 */
describe('parseAlbumIdParam', () => {
  const VALID = '00000000-0000-0000-0000-000000000001';

  it('returns the id unchanged for a well-formed UUID', () => {
    expect(parseAlbumIdParam(VALID)).toBe(VALID);
  });

  it('parses a well-formed-but-unknown UUID (existence is the use case job, not the guard)', () => {
    // Any structurally valid UUID passes — no catalog lookup here.
    expect(parseAlbumIdParam('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    );
  });

  it('throws UnprocessableEntityError (422) for a malformed param', async () => {
    try {
      parseAlbumIdParam('not-a-uuid');
      expect.unreachable('parseAlbumIdParam should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnprocessableEntityError);
      const e = err as UnprocessableEntityError;
      expect(e.status).toBe(422);
      expect(e.code).toBe('UNPROCESSABLE_ENTITY');
      expect(e.message).toBe('album not found: not-a-uuid');
    }
  });

  it('throws UnprocessableEntityError for an empty string param', () => {
    expect(() => parseAlbumIdParam('')).toThrow(UnprocessableEntityError);
  });
});

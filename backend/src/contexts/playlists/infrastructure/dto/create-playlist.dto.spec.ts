import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../../shared/errors/validation-error';
import { createPlaylistSchema, parseCreatePlaylistBody } from './create-playlist.dto';

/**
 * Create-playlist DTO specs (F5 — REQ-P-002, WORK-PR2-01).
 *
 * The schema enforces the LOCKED product decision #5 (title 1..100 chars) at
 * the HTTP edge. The entity re-validates after trimming; the DTO catches the
 * malformed-payload cases (empty / over-length / wrong type / missing) so the
 * global exception filter emits the canonical `VALIDATION_ERROR` 400 envelope
 * with field-scoped `details`.
 */
describe('createPlaylistSchema / parseCreatePlaylistBody', () => {
  describe('parseCreatePlaylistBody (wrapper)', () => {
    it('returns the trimmed-validated title on a happy 1-char parse', () => {
      const result = parseCreatePlaylistBody({ title: 'My Mix' });
      expect(result).toEqual({ title: 'My Mix' });
    });

    it('accepts the boundary 1-char title', () => {
      const result = parseCreatePlaylistBody({ title: 'A' });
      expect(result).toEqual({ title: 'A' });
    });

    it('accepts the boundary 100-char title', () => {
      const title = 'x'.repeat(100);
      const result = parseCreatePlaylistBody({ title });
      expect(result).toEqual({ title });
    });

    it('rejects the empty title as VALIDATION_ERROR with field=title', () => {
      expect(() => parseCreatePlaylistBody({ title: '' })).toThrowError(ValidationError);
      try {
        parseCreatePlaylistBody({ title: '' });
      } catch (err) {
        const v = err as ValidationError;
        expect(v.details.some((d) => d.field === 'title')).toBe(true);
      }
    });

    it('rejects the 101-char title as VALIDATION_ERROR', () => {
      expect(() =>
        parseCreatePlaylistBody({ title: 'x'.repeat(101) }),
      ).toThrowError(ValidationError);
    });

    it('rejects a missing title as VALIDATION_ERROR', () => {
      expect(() => parseCreatePlaylistBody({})).toThrowError(ValidationError);
    });

    it('rejects a non-string title as VALIDATION_ERROR', () => {
      expect(() => parseCreatePlaylistBody({ title: 42 })).toThrowError(ValidationError);
    });
  });

  describe('createPlaylistSchema (raw zod)', () => {
    it('safeParse returns success for a valid body', () => {
      const result = createPlaylistSchema.safeParse({ title: 'Valid' });
      expect(result.success).toBe(true);
    });

    it('safeParse returns failure for an empty title', () => {
      const result = createPlaylistSchema.safeParse({ title: '' });
      expect(result.success).toBe(false);
    });
  });
});

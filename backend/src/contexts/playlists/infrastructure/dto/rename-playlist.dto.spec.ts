import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../../shared/errors/validation-error';
import { parseRenamePlaylistBody, renamePlaylistSchema } from './rename-playlist.dto';

/**
 * Rename-playlist DTO specs (F5 — REQ-P-005, WORK-PR2-01).
 *
 * Identical shape to the create-playlist DTO (LOCKED product #5 — same 1..100
 * invariant on rename). Spec-pinned error code is `VALIDATION_ERROR` (400), so
 * the wrapper delegates straight to identity's `validate()` with no error-class
 * swap.
 */
describe('renamePlaylistSchema / parseRenamePlaylistBody', () => {
  describe('parseRenamePlaylistBody (wrapper)', () => {
    it('returns the parsed body on a happy parse', () => {
      expect(parseRenamePlaylistBody({ title: 'New Name' })).toEqual({
        title: 'New Name',
      });
    });

    it('accepts the boundary 1-char title', () => {
      expect(parseRenamePlaylistBody({ title: 'A' })).toEqual({ title: 'A' });
    });

    it('accepts the boundary 100-char title', () => {
      const title = 'y'.repeat(100);
      expect(parseRenamePlaylistBody({ title })).toEqual({ title });
    });

    it('rejects the empty title as VALIDATION_ERROR referencing title', () => {
      expect(() => parseRenamePlaylistBody({ title: '' })).toThrowError(ValidationError);
      try {
        parseRenamePlaylistBody({ title: '' });
      } catch (err) {
        expect((err as ValidationError).details.some((d) => d.field === 'title')).toBe(true);
      }
    });

    it('rejects the 101-char title as VALIDATION_ERROR', () => {
      expect(() =>
        parseRenamePlaylistBody({ title: 'y'.repeat(101) }),
      ).toThrowError(ValidationError);
    });

    it('rejects a missing title as VALIDATION_ERROR', () => {
      expect(() => parseRenamePlaylistBody({})).toThrowError(ValidationError);
    });
  });

  describe('renamePlaylistSchema (raw zod)', () => {
    it('safeParse returns success for a valid body', () => {
      expect(renamePlaylistSchema.safeParse({ title: 'Ok' }).success).toBe(true);
    });

    it('safeParse returns failure for a non-string title', () => {
      expect(renamePlaylistSchema.safeParse({ title: 7 }).success).toBe(false);
    });
  });
});

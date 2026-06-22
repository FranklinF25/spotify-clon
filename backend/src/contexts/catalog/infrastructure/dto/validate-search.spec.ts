import { describe, expect, it } from 'vitest';

import { InvalidQueryError } from '../../../../shared/errors/invalid-query-error';
import { validateSearch } from './validate-search';

/**
 * validateSearch wrapper specs (CAT-PR2b1-03).
 *
 * Pins the wrapper contract:
 *  - valid input passes through with `q` trimmed;
 *  - invalid input re-throws as `InvalidQueryError` (code `INVALID_QUERY`)
 *    so the spec-pinned token reaches the client (NOT `VALIDATION_ERROR`);
 *  - non-ValidationError exceptions pass through untouched.
 */
describe('validateSearch', () => {
  it('passes through a valid payload with trimmed q', () => {
    expect(validateSearch({ q: '  foo  ' })).toEqual({ q: 'foo' });
  });

  it('passes through a valid payload with type filter', () => {
    expect(validateSearch({ q: 'foo', type: 'artist' })).toEqual({
      q: 'foo',
      type: 'artist',
    });
  });

  it('re-throws empty q as InvalidQueryError (code INVALID_QUERY)', () => {
    try {
      validateSearch({ q: '' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidQueryError);
      expect((err as InvalidQueryError).code).toBe('INVALID_QUERY');
      expect((err as InvalidQueryError).status).toBe(400);
    }
  });

  it('re-throws whitespace-only q as InvalidQueryError', () => {
    expect(() => validateSearch({ q: '   ' })).toThrow(InvalidQueryError);
  });

  it('re-throws missing q as InvalidQueryError', () => {
    expect(() => validateSearch({})).toThrow(InvalidQueryError);
  });

  it('re-throws unknown type as InvalidQueryError', () => {
    expect(() => validateSearch({ q: 'foo', type: 'playlist' })).toThrow(InvalidQueryError);
  });
});

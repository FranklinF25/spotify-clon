import { describe, expect, it } from 'vitest';

import { searchSchema } from './search.dto';

/**
 * searchSchema unit specs (CAT-PR2b1-02).
 *
 * Pins the Zod schema used by `validateSearch`:
 *  - `q` is required, trimmed, and must be non-empty after trim.
 *  - `type` is optional and constrained to the three catalog entity kinds.
 *
 * The wrapper (CAT-PR2b1-03) re-throws Zod issues as `InvalidQueryError` so
 * the spec-pinned `INVALID_QUERY` token reaches the client.
 */
describe('searchSchema', () => {
  it('accepts a non-empty q', () => {
    const parsed = searchSchema.parse({ q: 'foo' });

    expect(parsed).toEqual({ q: 'foo' });
  });

  it('trims whitespace from q', () => {
    const parsed = searchSchema.parse({ q: '  foo  ' });

    expect(parsed.q).toBe('foo');
  });

  it('rejects an empty q', () => {
    expect(() => searchSchema.parse({ q: '' })).toThrow();
  });

  it('rejects a whitespace-only q (becomes empty after trim)', () => {
    expect(() => searchSchema.parse({ q: '   ' })).toThrow();
  });

  it('rejects a missing q', () => {
    expect(() => searchSchema.parse({})).toThrow();
  });

  it('accepts type: artist', () => {
    expect(searchSchema.parse({ q: 'foo', type: 'artist' })).toEqual({
      q: 'foo',
      type: 'artist',
    });
  });

  it('accepts type: album', () => {
    expect(searchSchema.parse({ q: 'foo', type: 'album' })).toEqual({
      q: 'foo',
      type: 'album',
    });
  });

  it('accepts type: track', () => {
    expect(searchSchema.parse({ q: 'foo', type: 'track' })).toEqual({
      q: 'foo',
      type: 'track',
    });
  });

  it('rejects an unknown type', () => {
    expect(() => searchSchema.parse({ q: 'foo', type: 'playlist' })).toThrow();
  });
});

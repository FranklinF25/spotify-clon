import { searchSchema } from './search';

describe('searchSchema', () => {
  it('parses a query with no type (populate-all-three case)', () => {
    expect(searchSchema.safeParse({ q: 'foo' }).success).toBe(true);
  });

  it('parses a query with each singular type', () => {
    expect(searchSchema.safeParse({ q: 'foo', type: 'artist' }).success).toBe(
      true,
    );
    expect(searchSchema.safeParse({ q: 'foo', type: 'album' }).success).toBe(
      true,
    );
    expect(searchSchema.safeParse({ q: 'foo', type: 'track' }).success).toBe(
      true,
    );
  });

  // JD fix #1 — `type` is a SINGULAR enum, NOT a comma-joined plural.
  it('rejects an invalid type value with an issue on type', () => {
    const result = searchSchema.safeParse({ q: 'foo', type: 'foo' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('type')),
      ).toBe(true);
    }
  });

  it('rejects an empty q with an issue on q', () => {
    const result = searchSchema.safeParse({ q: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('q'))).toBe(true);
    }
  });
});

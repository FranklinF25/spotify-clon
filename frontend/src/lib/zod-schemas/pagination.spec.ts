import { paginationSchema } from './pagination';

describe('paginationSchema', () => {
  it('applies defaults {page:1, pageSize:20} when given an empty object', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces string inputs to numbers (query-string provenance)', () => {
    expect(
      paginationSchema.parse({ page: '2', pageSize: '50' }),
    ).toEqual({ page: 2, pageSize: 50 });
  });

  it('rejects a pageSize over 100 with an issue on pageSize', () => {
    const result = paginationSchema.safeParse({ page: 1, pageSize: 101 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('pageSize')),
      ).toBe(true);
    }
  });

  it('rejects a non-positive page', () => {
    expect(
      paginationSchema.safeParse({ page: 0, pageSize: 20 }).success,
    ).toBe(false);
  });
});

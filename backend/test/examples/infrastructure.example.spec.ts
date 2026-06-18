import { describe, expect, it } from 'vitest';

/**
 * Illustrative infrastructure-layer test.
 *
 * Adapter responsibility is data mapping (persistence row <-> domain/view);
 * that transformation is pure and testable without a database. Real Prisma
 * adapter integration specs (testcontainers Postgres 16) land in PR-3 under
 * contexts/identity/infrastructure/*.integration-spec.ts.
 */
interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

interface UserView {
  id: string;
  email: string;
  displayName: string;
}

function mapRowToView(row: UserRow): UserView {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

describe('infrastructure layer example (adapter row mapping)', () => {
  it('maps a snake_case persistence row to a camelCase view', () => {
    expect(mapRowToView({ id: 'u1', email: 'a@b.com', display_name: 'Alice' })).toEqual({
      id: 'u1',
      email: 'a@b.com',
      displayName: 'Alice',
    });
  });

  it('preserves the id and email verbatim across mapping', () => {
    const view = mapRowToView({ id: 'u-uuid', email: 'x@y.z', display_name: 'Bob' });
    expect(view.id).toBe('u-uuid');
    expect(view.email).toBe('x@y.z');
  });
});

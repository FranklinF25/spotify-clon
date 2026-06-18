import { describe, expect, it } from 'vitest';

/**
 * Illustrative framework-agnostic domain test.
 *
 * Proves the `unit` project runs for the domain layer and depends on no
 * infrastructure framework (no NestJS, Prisma, or node-only imports here —
 * a precondition the architecture portfolio test will keep enforced). Real
 * identity entity specs land in PR-2 under contexts/identity/domain/.
 */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

describe('domain layer example (framework-agnostic)', () => {
  it('normalizes a messy email to trimmed lowercase', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('preserves an already-clean email unchanged', () => {
    expect(normalizeEmail('bob@example.com')).toBe('bob@example.com');
  });
});

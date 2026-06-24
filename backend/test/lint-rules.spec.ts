import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * Lint-rule contract regression guard (PB-PR3-02 / PB-PR3-03 / PB-PR2-13).
 *
 * REQ-BF-008 + REQ-BF-009 — verifies that the two coordinated ESLint rules
 * landed in PR-1 (CRIT-2 domain migration) and PR-3 (CRIT-1 cross-context
 * concrete-adapter ban) actually fire / pass on the contract they document.
 * Each fixture under `test/fixtures/lint/` encodes a rule contract; this
 * spec runs ESLint's `lintText` API with a SYNTHETIC `filePath` so the
 * flat-config `files` / `ignores` matchers apply as if the fixture lived
 * at the target context location.
 *
 * Why synthetic paths: the fixtures physically live under
 * `test/fixtures/lint/` (outside `src/contexts/**`), so they would never
 * be matched by the rule's `files` globs if linted at their real path.
 * Running them as if they lived at `src/contexts/playback/{domain,
 * infrastructure}/...` exercises the real flat-config matching engine
 * end-to-end (this is the same engine that runs in `pnpm exec eslint .`,
 * so a regression in the rule's `files` / `ignores` shape is caught here).
 *
 * REQ-BF-009 scenario "Rule is green on main before playback lands" —
 * the rule must be present AND enforcement must work. The four positive
 * fixtures below prove enforcement; the catalog-own-import sanity test
 * proves the `ignores` carve-out (catalog remains free to use its own
 * adapter).
 *
 * Skill reference: PR-1 PB-PR1-13 (CRIT-2 domain migration), PR-3
 * PB-PR3-01 (CRIT-1 cross-context ban).
 */

const projectRoot = process.cwd(); // backend/ when vitest runs
const fixturesDir = resolve(projectRoot, 'test', 'fixtures', 'lint');

function loadFixture(name: string): string {
  const path = resolve(fixturesDir, name);
  expect(existsSync(path), `fixture ${name} must exist at ${path}`).toBe(true);
  return readFileSync(path, 'utf8');
}

const eslint = new ESLint({ cwd: projectRoot });

/**
 * Lints `content` as if it lived at `filePath` (relative to the backend
 * project root) and returns the resulting lint messages.
 *
 * Filters out incidental `@typescript-eslint/no-unused-vars` noise so the
 * rule-specific assertions stay focused; the fixtures are written to use
 * every imported identifier, but defensive filtering keeps the test
 * resilient to future eslint-recommended tightening.
 */
async function lintAs(
  content: string,
  filePath: string,
): Promise<ESLint.LintMessage[]> {
  const results = await eslint.lintText(content, { filePath });
  expect(results, 'lintText must return exactly one result').toHaveLength(1);
  return results[0].messages;
}

describe('lint rule contracts (REQ-BF-008 + REQ-BF-009)', () => {
  it('allows type-only node:* imports in domain (CRIT-2 allowTypeImports on node:*)', async () => {
    // REQ-BF-009 scenario "Type-only Readable import in domain is allowed".
    // The playback domain `AudioStream = Readable` alias depends on this.
    const content = loadFixture('domain-type-only-node.pass.ts');
    const messages = await lintAs(
      content,
      'src/contexts/playback/domain/types.ts',
    );
    expect(messages, JSON.stringify(messages, null, 2)).toEqual([]);
  });

  it('bans runtime node:* imports in domain (allowTypeImports is type-only)', async () => {
    // REQ-BF-009 scenario "Domain runtime node:* imports are blocked".
    // `allowTypeImports: true` opens ONLY the type-only door — runtime
    // imports from `node:*` stay banned.
    const content = loadFixture('domain-runtime-node.fail.ts');
    const messages = await lintAs(
      content,
      'src/contexts/playback/domain/types.ts',
    );
    const ruleMessages = messages.filter(
      (m) => m.ruleId === '@typescript-eslint/no-restricted-imports',
    );
    expect(
      ruleMessages.length,
      'expected at least one @typescript-eslint/no-restricted-imports error',
    ).toBeGreaterThanOrEqual(1);
    const text = ruleMessages.map((m) => m.message).join('\n');
    expect(text, 'rule message should reference node:').toContain('node:');
    expect(text, 'rule message should reference runtime').toContain('runtime');
  });

  it('bans type-only imports from non-node specifiers in domain (allowTypeImports is node:*-only)', async () => {
    // REQ-BF-009 scenario "Domain type-only imports from non-node
    // specifiers are blocked". A future maintainer who widens
    // `allowTypeImports` accidentally to all patterns will be caught here.
    const content = loadFixture('domain-type-only-nestjs.fail.ts');
    const messages = await lintAs(
      content,
      'src/contexts/playback/domain/types.ts',
    );
    const ruleMessages = messages.filter(
      (m) => m.ruleId === '@typescript-eslint/no-restricted-imports',
    );
    expect(
      ruleMessages.length,
      'expected at least one @typescript-eslint/no-restricted-imports error',
    ).toBeGreaterThanOrEqual(1);
    const text = ruleMessages.map((m) => m.message).join('\n');
    expect(text, 'rule message should mention @nestjs/common').toContain(
      '@nestjs/common',
    );
  });

  it('bans cross-context PrismaCatalogRepository imports (CRIT-1 concrete-adapter ban)', async () => {
    // REQ-BF-009 scenario "Cross-context concrete adapter import is
    // blocked". Playback must depend on the CATALOG_REPOSITORY_PORT
    // Symbol token (exported by CatalogModule), never the concrete
    // Prisma adapter.
    const content = loadFixture('cross-context-concrete-adapter.fail.ts');
    const messages = await lintAs(
      content,
      'src/contexts/playback/infrastructure/playback.module.ts',
    );
    const ruleMessages = messages.filter(
      (m) => m.ruleId === 'no-restricted-imports',
    );
    expect(
      ruleMessages.length,
      'expected at least one no-restricted-imports error',
    ).toBeGreaterThanOrEqual(1);
    const text = ruleMessages.map((m) => m.message).join('\n');
    expect(text, 'rule message should mention CATALOG_REPOSITORY_PORT').toContain(
      'CATALOG_REPOSITORY_PORT',
    );
  });

  it('does NOT fire the cross-context ban inside catalog (catalog owns its adapter)', async () => {
    // Sanity check: the rule's `ignores` array exempts catalog's own
    // tree. Without this, catalog.module.ts itself would fail lint.
    // REQ-BF-009 scenario "Rule is green on main before playback lands".
    const content =
      "import { PrismaCatalogRepository } from './prisma-catalog.repository';\nexport const _X = PrismaCatalogRepository;\n";
    const messages = await lintAs(
      content,
      'src/contexts/catalog/infrastructure/catalog.module.ts',
    );
    const crossContextMessages = messages.filter(
      (m) => m.ruleId === 'no-restricted-imports',
    );
    expect(
      crossContextMessages,
      'cross-context rule must NOT fire inside catalog (ignored)',
    ).toEqual([]);
  });
});

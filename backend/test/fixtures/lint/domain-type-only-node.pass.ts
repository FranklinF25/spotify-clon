// Fixture: lint-rule contract documentation (PB-PR3-02 / PB-PR2-13).
//
// Expected lint result: PASS (0 errors) when linted AS IF it lived at
//   `src/contexts/playback/domain/types.ts` — the playback domain file
//   that owns the `AudioStream = Readable` alias.
//
// Rule under test: `@typescript-eslint/no-restricted-imports` with
//   `allowTypeImports: true` on the `node:*` pattern (CRIT-2 from
//   Judgment Day R2; migrated in PR-1 PB-PR1-13).
//
// The `import type` is erased at compile time → no runtime `node:stream`
// import lands in the domain tree → REQ-BF-008 stays satisfied AND the
// architecture test's `importClause.isTypeOnly()` filter skips this
// declaration. REQ-BF-009 scenario "Type-only Readable import in domain
// is allowed".
//
// IMPORTANT: this fixture file is NOT linted directly by `pnpm exec eslint .`
// — it lives under `test/fixtures/lint/`, outside the rule's file scope
// (`src/contexts/*/domain/**/*.ts`). The lint-rules.spec.ts loads this
// file's content and passes it to ESLint's `lintText()` with a synthetic
// `filePath` so the rule is applied as if the file were at the target
// location.
import type { Readable } from 'node:stream';

export type AudioStream = Readable;

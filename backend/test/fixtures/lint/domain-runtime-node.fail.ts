// Fixture: lint-rule contract documentation (PB-PR3-02 / PB-PR2-13).
//
// Expected lint result: FAIL (≥1 error) when linted AS IF it lived at
//   `src/contexts/playback/domain/types.ts`.
//
// Rule under test: `@typescript-eslint/no-restricted-imports` with
//   `allowTypeImports: true` on the `node:*` pattern (CRIT-2 from
//   Judgment Day R2; migrated in PR-1 PB-PR1-13).
//
// `allowTypeImports: true` ONLY opens the door for `import type` —
// runtime imports from `node:*` specifiers stay banned. A runtime
// `import { Readable } from 'node:stream'` would pull Node's stream
// module into the domain tree at process boot, contaminating the
// framework-free domain layer (REQ-BF-008 + REQ-BF-009 scenario
// "Domain runtime node:* imports are blocked").
//
// Contrast with `domain-type-only-node.pass.ts` — the only difference
// is the absence of `type` on the import clause.
//
// IMPORTANT: this fixture file is NOT linted directly by `pnpm exec eslint .`
// — see the pass-fixture header for the testing mechanism.
import { Readable } from 'node:stream';

export type AudioStream = Readable;

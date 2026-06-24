// Fixture: lint-rule contract documentation (PB-PR3-02 / PB-PR2-13).
//
// Expected lint result: FAIL (≥1 error) when linted AS IF it lived at
//   `src/contexts/playback/domain/types.ts`.
//
// Rule under test: `@typescript-eslint/no-restricted-imports` with
//   `allowTypeImports: true` ONLY on the `node:*` pattern (CRIT-2 from
//   Judgment Day R2; migrated in PR-1 PB-PR1-13).
//
// REQ-BF-009 scenario "Domain type-only imports from non-node specifiers
// are blocked": `allowTypeImports: true` is intentionally scoped to the
// `node:*` pattern only. Type-only imports from `@nestjs/*`, `@prisma/*`,
// `express`, `rxjs`, `pino` stay banned — the domain layer is
// framework-free even at the type level (a NestJS-typed domain would
// couple the pure domain model to framework abstractions via type
// inference even with no runtime cost). A `import type { Injectable }`
// from `@nestjs/common` MUST therefore still fail.
//
// This fixture proves `allowTypeImports` is narrowly applied — a
// future maintainer who widens it accidentally will be caught here.
//
// IMPORTANT: this fixture file is NOT linted directly by `pnpm exec eslint .`
// — see `domain-type-only-node.pass.ts` for the testing mechanism.
import type { Injectable } from '@nestjs/common';

export type _Marker = Injectable;

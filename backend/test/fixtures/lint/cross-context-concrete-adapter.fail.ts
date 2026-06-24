// Fixture: lint-rule contract documentation (PB-PR3-02 / PB-PR2-13).
//
// Expected lint result: FAIL (≥1 error mentioning 'CATALOG_REPOSITORY_PORT')
//   when linted AS IF it lived at
//   `src/contexts/playback/infrastructure/playback.module.ts`.
//
// Rule under test: stock `no-restricted-imports` cross-context
//   concrete-adapter ban (CRIT-1 from Judgment Day R2; added in PR-3
//   PB-PR3-01).
//
// The first cross-context edge in the portfolio is playback → catalog.
// Playback MUST consume `CatalogRepositoryPort` via the
// `CATALOG_REPOSITORY_PORT` Symbol token (exported additively by
// `CatalogModule` per PB-PR2-02), NEVER the concrete
// `PrismaCatalogRepository` adapter directly. Importing the concrete
// adapter here would tie playback's compilation graph + DI lifecycle to
// catalog's Prisma implementation, defeating the entire point of the
// port contract. This fixture proves the rule fires when a consumer
// tries to bypass the port token.
//
// REQ-BF-009 scenarios "Cross-context concrete adapter import is blocked"
// and "Rule is green on main before playback lands" (the latter is the
// gate assertion: the rule must be present AND enforcement works).
//
// IMPORTANT: this fixture file is NOT linted directly by `pnpm exec eslint .`
// — the relative specifier `'../../../catalog/infrastructure/...'` is
// shaped for a file at `src/contexts/playback/infrastructure/`. The
// lint-rules.spec.ts loads this file's content and passes it to ESLint's
// `lintText()` with that synthetic `filePath` so the rule matches.
import { PrismaCatalogRepository } from '../../../catalog/infrastructure/prisma-catalog.repository';

export const _ConcreteAdapter = PrismaCatalogRepository;

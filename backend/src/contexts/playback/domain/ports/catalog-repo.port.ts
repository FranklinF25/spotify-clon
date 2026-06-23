// Single re-export entry point — playback's ONLY catalog dependency.
//
// `playback` consumes `CatalogRepositoryPort.findTrackById` to resolve a
// track's `filePath` before streaming. The concrete `PrismaCatalogRepository`
// is NEVER imported here (cross-context concrete-adapter ban enforced by
// ESLint in PR-2; the port contract is locked + additive-only per catalog's
// evolution rules). DI resolves the port via `CATALOG_REPOSITORY_PORT`
// (Symbol token exported by `CatalogModule`, added in PR-2).
//
// This shim is the canonical place every playback file imports catalog from;
// any future bypass of this shim (direct import of the catalog port file)
// SHOULD go through the cross-context concrete-adapter ban's glob (PR-2).
//
// The catalog port file exports `CatalogRepositoryPort` as a `type`-only
// interface (it has no runtime implementation — it is a contract), so this
// shim re-uses `export type`.
export type { CatalogRepositoryPort } from '../../../catalog/domain/ports/catalog-repository.port';

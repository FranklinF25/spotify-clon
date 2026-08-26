// Symbol DI token for the catalog repository port (C3 fix — additive, PR-2).
//
// NestJS interfaces erase to `undefined` at runtime, so consumers cannot
// resolve `provide: CatalogRepositoryPort`. Symbols survive TypeScript's
// type erasure and are the canonical NestJS pattern for binding interface-
// typed ports. Mirrors identity's `IDENTITY_CONFIG` + playback's
// `AUDIO_STORAGE_PORT` / `RANGE_PARSER_PORT` Symbol-token approach.
//
// `CatalogModule` binds this token via
// `{ provide: CATALOG_REPOSITORY_PORT, useExisting: PrismaCatalogRepository }`
// and EXPORTS it so cross-context consumers (playback's `PlaybackModule`)
// can inject the port contract without depending on the concrete adapter
// (`PrismaCatalogRepository`). This is an ADDITIVE evolution: no existing
// catalog provider is removed or renamed, and the concrete adapter stays
// the canonical implementation inside the catalog tree.

/**
 * DI token for the `CatalogRepositoryPort` driven port. Implemented by
 * `PrismaCatalogRepository` in production; consumed cross-context by
 * `PlaybackModule` (PR-2) which injects the PORT CONTRACT — never the
 * concrete adapter (REQ-PLAY-006 scenario "CatalogModule exports
 * CATALOG_REPOSITORY_PORT").
 */
export const CATALOG_REPOSITORY_PORT = Symbol('CATALOG_REPOSITORY_PORT');

/**
 * DI token for the `AudioFileWriterPort` driven port (REQ-UPLOAD-001).
 * Implemented by `FsAudioFileWriter` (catalog infrastructure) in production
 * and bound via `useFactory` + `inject: [ENV_CONFIG]` in `CatalogModule` —
 * the explicit-factory pattern every catalog provider follows (esbuild /
 * Vitest reflect-metadata caveat). `CatalogModule` does NOT export the
 * token: the writer is catalog-internal (no cross-context consumer).
 */
export const AUDIO_FILE_WRITER_PORT = Symbol('AUDIO_FILE_WRITER_PORT');

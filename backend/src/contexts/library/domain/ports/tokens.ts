// Symbol DI token for the library repository port (F6 — design §3).
//
// NestJS interfaces erase to `undefined` at runtime, so consumers cannot
// resolve `provide: LibraryRepositoryPort`. Symbols survive TypeScript's
// type erasure and are the canonical NestJS pattern for binding interface-
// typed ports. Mirrors playlists' `PLAYLISTS_REPOSITORY_PORT`
// (playlists/domain/ports/tokens.ts) verbatim.
//
// `LibraryModule` (PR-2) will bind this token via
// `{ provide: LIBRARY_REPOSITORY_PORT, useExisting: PrismaLibraryRepository }`
// and EXPORT it so future cross-context consumers can inject the port
// contract without depending on the concrete adapter.

/**
 * DI token for the `LibraryRepositoryPort` driven port. Implemented by
 * `PrismaLibraryRepository` in production; consumed by every library use
 * case via constructor injection.
 */
export const LIBRARY_REPOSITORY_PORT = Symbol('LIBRARY_REPOSITORY_PORT');

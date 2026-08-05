// Symbol DI token for the playlists repository port (F5 — design §7).
//
// NestJS interfaces erase to `undefined` at runtime, so consumers cannot
// resolve `provide: PlaylistsRepositoryPort`. Symbols survive TypeScript's
// type erasure and are the canonical NestJS pattern for binding interface-
// typed ports. Mirrors catalog's `CATALOG_REPOSITORY_PORT` and playback's
// `AUDIO_STORAGE_PORT` / `RANGE_PARSER_PORT` Symbol-token approach.
//
// `PlaylistsModule` (PR-2) will bind this token via
// `{ provide: PLAYLISTS_REPOSITORY_PORT, useExisting: PrismaPlaylistsRepository }`
// and EXPORT it so future cross-context consumers can inject the port
// contract without depending on the concrete adapter.

/**
 * DI token for the `PlaylistsRepositoryPort` driven port. Implemented by
 * `PrismaPlaylistsRepository` in production; consumed by every playlists use
 * case via constructor injection.
 */
export const PLAYLISTS_REPOSITORY_PORT = Symbol('PLAYLISTS_REPOSITORY_PORT');

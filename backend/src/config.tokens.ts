/**
 * DI token for the validated environment configuration.
 *
 * Extracted from `app.module.ts` (CRIT-3) so consumers (e.g. the playback
 * `FsAudioStorage` adapter + `PlaybackModule` factory) can import the token
 * without pulling the entire `AppModule` graph. `app.module.ts` re-exports
 * this symbol for backward compatibility — every existing consumer of
 * `'./app.module'` keeps resolving unchanged.
 *
 * Contexts and adapters inject `ENV_CONFIG` instead of reading `process.env`
 * directly; the validated `EnvConfig` object is provided by `AppModule`'s
 * `useFactory: () => loadConfig()` provider.
 */
export const ENV_CONFIG = Symbol('ENV_CONFIG');

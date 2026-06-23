// Symbol DI tokens for the playback bounded context.
//
// NestJS interfaces erase to `undefined` at runtime — `provide: AudioStoragePort`
// cannot resolve (C2 fix from Judgment Day). Symbols survive TypeScript's
// type erasure and are the canonical NestJS pattern for binding interface-
// typed ports. Mirrors identity's `IDENTITY_CONFIG` Symbol-token approach.
//
// Bound in `PlaybackModule` (PR-2) via `useFactory` + `inject`; injected
// into `StreamTrackUseCase` so the use case depends on the PORT CONTRACT,
// not on a concrete adapter (hexagonal driven-side pattern).

/**
 * DI token for the `AudioStoragePort` driven port. Implemented by
 * `FsAudioStorage` in production; replaced by a fake in unit specs.
 */
export const AUDIO_STORAGE_PORT = Symbol('AUDIO_STORAGE_PORT');

/**
 * DI token for the `RangeParserPort` driven port. Implemented by
 * `RangeParserAdapter` (wrapping the `range-parser` package) in production;
 * replaced by a fake in unit specs.
 */
export const RANGE_PARSER_PORT = Symbol('RANGE_PARSER_PORT');

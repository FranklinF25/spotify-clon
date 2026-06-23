import type { AudioStream } from '../types';

/**
 * Driven port (secondary) — abstracts byte-range access to the audio store.
 *
 * Production implementation: `FsAudioStorage` (filesystem adapter, the ONLY
 * place playback touches `node:fs`). Test fakes: in-memory stubs returning
 * canned `Readable` streams.
 *
 * The S3 swap point: a future `S3AudioStorage` adapter would implement this
 * port without touching `StreamTrackUseCase` — that is the architectural
 * payload of isolating storage behind a port.
 *
 * Framework-free by design: pure TS interface, zero NestJS / Prisma / node:
 * runtime imports (enforced by ESLint boundaries + the architecture portfolio
 * test, REQ-BF-008).
 */
export interface AudioStoragePort {
  /**
   * Returns the file size in bytes. Throws `NotFoundError('audio-file', path)`
   * if the file is missing on disk — this maps to the existing `NOT_FOUND`
   * envelope (REQ-PLAY-001 404 path also covers "track exists in DB but
   * file missing on disk", W-fs-stat-enoent).
   */
  stat(filePath: string): Promise<{ size: number }>;

  /**
   * Opens a byte range (or the whole file when `range` is null) as a
   * `Readable` stream. The caller (`StreamTrackUseCase`) wraps the stream
   * in a `StreamResult` and pipes it downstream via Nest's `StreamableFile`.
   */
  open(filePath: string, range: { start: number; end: number } | null): AudioStream;
}

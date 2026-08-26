/**
 * Driven port (secondary) — writes an uploaded audio file under the audio
 * library root (REQ-UPLOAD-001 hexagonal write path).
 *
 * The catalog context's ONLY write access to the filesystem. The upload use
 * case derives a flat relative path (`Artist - Title.ext`, sanitized) and
 * hands the raw bytes to this port; the concrete adapter decides where the
 * audio root lives (`<AUDIO_STORAGE_PATH>/audio` — the same root the seeder
 * scans and `FsAudioStorage` serves from, so an uploaded file is
 * immediately streamable).
 *
 * Contract:
 *  - `relativePath` is a POSIX-style path RELATIVE to the audio root. The
 *    adapter MUST resolve it under the root and REJECT anything that
 *    resolves outside it (path-traversal guard) — a plain `startsWith`
 *    check is flawed (`/data/audio-safe` starts with `/data/audio`), so the
 *    guard uses `path.relative` escape detection.
 *  - Parent directories are created as needed (`mkdir -p` semantics) — the
 *    audio root may not exist yet on a fresh volume.
 *  - An existing file at the same path is OVERWRIVEN (idempotent re-upload;
 *    the derived track id is a function of the same relative path).
 *
 * Framework-free by design: pure TS interface, zero NestJS / node:fs
 * imports (enforced by ESLint boundaries + the architecture portfolio
 * test). `Buffer` is referenced as an ambient @types/node global — no
 * runtime import, so domain purity holds.
 */
export interface AudioFileWriterPort {
  /** Persist `bytes` at `relativePath` under the audio root. */
  writeFile(relativePath: string, bytes: Buffer): Promise<void>;
}

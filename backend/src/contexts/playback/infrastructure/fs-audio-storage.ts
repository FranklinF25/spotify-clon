import { createReadStream, promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { EnvConfig } from '../../../config';
import { NotFoundError } from '../../../shared/errors/not-found-error';
import type { AudioStoragePort } from '../domain/ports/audio-storage.port';
import type { AudioStream } from '../domain/types';

/**
 * Driven adapter (infrastructure) that turns `AudioStoragePort` into
 * `node:fs` calls. The ONLY place in playback that touches the filesystem.
 *
 * Plain class — NO `@Injectable` / `@Inject` decorators (W-dead-injectable).
 * `PlaybackModule` (PR-2) instantiates it explicitly via `useFactory`
 * because the esbuild/Vitest reflect-metadata caveat makes Nest DI
 * metadata unreliable for constructor params.
 *
 * Carry-overs (documented in tasks.md Carry-Over Mapping):
 *  - CO-playback-1: `open()` attaches an `'error'` listener that destroys
 *    the stream on mid-flight failure; logging is deferred until a
 *    measurable need appears.
 *  - CO-playback-2: `resolve()` uses `path.relative` for the traversal
 *    guard but does NOT `fs.realpath` symlinks. Symlink escape is
 *    theoretical at demo scale (single-tenant, fixture mp3s, no
 *    untrusted uploads); future hardening would call `fs.realpath` on
 *    both root and target before the relative check.
 */
export class FsAudioStorage implements AudioStoragePort {
  constructor(private readonly config: EnvConfig) {}

  /**
   * Resolves a `filePath` (DB-stored, seed-style `/audio/...`) against the
   * configured `AUDIO_STORAGE_PATH` root.
   *
   * Two responsibilities:
   *  1. Strip a leading slash — the seed writes `filePath` rooted at
   *     `/audio/...`; stripping it lets `path.resolve` join cleanly so the
   *     resolved path is `<root>/audio/...` (C8 fix — NOT `<root>/audio/audio/...`).
   *  2. Path-traversal guard via `path.relative` (W-pathguard). A plain
   *     `startsWith(root)` check is flawed: `/data/audio-safe` would
   *     `startsWith('/data/audio')` but resolve OUTSIDE the tree.
   *     `path.relative` produces a `..` prefix ONLY when the target
   *     escapes the root — that is the correct invariant.
   */
  private resolve(filePath: string): string {
    const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    const rootResolved = path.resolve(this.config.AUDIO_STORAGE_PATH);
    const absolute = path.resolve(rootResolved, normalized);

    const rel = path.relative(rootResolved, absolute);
    if (rel === '..' || rel.startsWith(`..${path.sep}`)) {
      throw new Error(`Path traversal attempt blocked: ${filePath}`);
    }
    return absolute;
  }

  async stat(filePath: string): Promise<{ size: number }> {
    try {
      const stats = await fs.stat(this.resolve(filePath));
      return { size: stats.size };
    } catch (err) {
      // W-fs-stat-enoent — ENOENT would otherwise bubble as an undocumented
      // 500. Translate to NotFoundError('audio-file', path) so the global
      // filter emits the canonical NOT_FOUND envelope (REQ-PLAY-001 404
      // path also covers "track exists in DB but file missing on disk").
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError('audio-file', filePath);
      }
      throw err;
    }
  }

  open(filePath: string, range: { start: number; end: number } | null): AudioStream {
    const stream = createReadStream(
      this.resolve(filePath),
      range ? { start: range.start, end: range.end } : {},
    );
    // W-stream-errors — attach an error handler so a mid-flight read error
    // (file truncated after stat, disk fault) does not become an unhandled
    // 'error' event that crashes the process. By the time this fires the
    // response headers are already flushed, so we can only destroy the
    // stream and let the client observe a truncated body. Logging is
    // deferred to a future hardening pass (CO-playback-1).
    stream.on('error', () => {
      stream.destroy();
    });
    // `AudioStream = Readable` (domain type alias over `import type`).
    // `createReadStream` returns a `Readable` structurally identical to
    // the alias's referent — no cast required.
    return stream as AudioStream;
  }
}

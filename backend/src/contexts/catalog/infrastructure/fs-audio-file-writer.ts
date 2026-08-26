import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { EnvConfig } from '../../../config';
import type { AudioFileWriterPort } from '../domain/ports/audio-file-writer.port';

/**
 * Driven adapter (infrastructure) that turns `AudioFileWriterPort` into
 * `node:fs` calls — the ONLY place in catalog that writes to the
 * filesystem (REQ-UPLOAD-001).
 *
 * Plain class — NO `@Injectable` / `@Inject` decorators. `CatalogModule`
 * instantiates it explicitly via `useFactory` + `inject: [ENV_CONFIG]`
 * because the esbuild/Vitest reflect-metadata caveat makes Nest DI
 * constructor metadata unreliable (same pattern as `FsAudioStorage` in
 * playback and every catalog provider).
 *
 * Audio root: `<AUDIO_STORAGE_PATH>/audio` — the SAME root the seeder
 * scans (`resolveAudioRoot`) and `FsAudioStorage` serves from, so a file
 * written here is immediately streamable and a later re-seed picks it up.
 *
 * Path-traversal guard (W-pathguard, mirrors `FsAudioStorage.resolve`): a
 * plain `startsWith(root)` check is flawed — `/data/audio-safe` starts with
 * `/data/audio` but resolves OUTSIDE the tree. `path.relative` produces a
 * `..` prefix ONLY when the target escapes the root — that is the correct
 * invariant. The guard throws a plain Error (→ 500 INTERNAL_ERROR via the
 * global filter): the input relative path is derived by the use case's
 * sanitizer, so a traversal reaching this layer is an internal bug, not a
 * client error. Symlink escape is not re-checked via `fs.realpath` — same
 * theoretical-at-demo-scale stance as playback's storage adapter
 * (CO-playback-2).
 */
export class FsAudioFileWriter implements AudioFileWriterPort {
  constructor(private readonly config: EnvConfig) {}

  async writeFile(relativePath: string, bytes: Buffer): Promise<void> {
    // Audio root = AUDIO_STORAGE_PATH + '/audio' (AUDIO_STORAGE_PATH is the
    // PARENT of the audio dir — config.ts C8 note).
    const root = path.resolve(this.config.AUDIO_STORAGE_PATH, 'audio');
    const absolute = path.resolve(root, relativePath);

    const rel = path.relative(root, absolute);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`Path traversal attempt blocked: ${relativePath}`);
    }

    // mkdir -p semantics — the audio root (or a future nested artist dir)
    // may not exist yet on a fresh volume. Recursive is idempotent.
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    // Overwrite-by-default: an idempotent re-upload must replace the bytes,
    // not fail on the existing file (REQ-UPLOAD-004).
    await fs.writeFile(absolute, bytes);
  }
}

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EnvConfig } from '../../../config';
import { NotFoundError } from '../../../shared/errors/not-found-error';
import { FsAudioStorage } from './fs-audio-storage';

/**
 * Unit spec for `FsAudioStorage` (PB-PR1-10).
 *
 * Covers REQ-PLAY-003:
 *   1. valid relative path resolves and `stat` returns the real OS-reported size;
 *   2. path traversal `../../../etc/passwd` throws inside resolve();
 *   3. leading-slash `/audio/album/track.mp3` normalizes (NO doubled segment);
 *   4. `stat()` on a missing file throws NotFoundError('audio-file', filePath)
 *      (W-fs-stat-enoent — NOT a generic 500);
 *   5. `open(filePath, null)` returns a Readable whose bytes match the file
 *      content (read the stream into a Buffer and assert equality).
 *
 * Uses `os.tmpdir()` + `fs.mkdtemp` for an isolated, OS-cleaned fixture root.
 * Each test creates its own tmp fixture and tears it down in afterEach.
 */
function makeConfig(audioStoragePath: string): EnvConfig {
  // Minimal EnvConfig stub for FsAudioStorage, which reads ONLY
  // AUDIO_STORAGE_PATH. The cast documents the test's narrow dependency —
  // the production EnvConfig has many more fields (validated by Zod at
  // boot), none of which this adapter touches.
  return { AUDIO_STORAGE_PATH: audioStoragePath } as EnvConfig;
}

/** Drain a Readable into a Buffer (used by the open() byte-equality test). */
async function drainStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('FsAudioStorage', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'playback-fs-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('REQ-PLAY-003 — filesystem audio storage adapter', () => {
    it('1. resolves a valid relative path and stat returns the real OS-reported size', async () => {
      // Arrange a nested fixture file under the tmp root.
      await fs.mkdir(join(root, 'album'));
      const payload = Buffer.from('hello-bytes');
      await fs.writeFile(join(root, 'album', 'track.mp3'), payload);

      const storage = new FsAudioStorage(makeConfig(root));

      const result = await storage.stat('album/track.mp3');

      expect(result.size).toBe(payload.length);
    });

    it('2. rejects a path-traversal attempt (../../../etc/passwd) inside resolve()', async () => {
      const storage = new FsAudioStorage(makeConfig(root));

      // The traversal guard fires inside the private resolve() — observable
      // via stat() which calls resolve() before fs.stat(). The error
      // message documents the intent (the spec only requires it to throw).
      await expect(storage.stat('../../../etc/passwd')).rejects.toThrow(/traversal/i);
    });

    it('3. normalizes a leading slash (/audio/album/track.mp3 → <root>/audio/album/track.mp3, NO doubled segment)', async () => {
      // C8 fix — the configured value is the PARENT of the audio root.
      // seed.ts writes filePath rooted at `/audio/...`; resolve() strips
      // the leading slash so the resolved path is `<root>/audio/...`
      // (NOT `<root>/audio/audio/...`).
      await fs.mkdir(join(root, 'audio', 'album'), { recursive: true });
      const payload = Buffer.from('normalized-leading-slash');
      await fs.writeFile(join(root, 'audio', 'album', 'track.mp3'), payload);

      const storage = new FsAudioStorage(makeConfig(root));

      const result = await storage.stat('/audio/album/track.mp3');

      expect(result.size).toBe(payload.length);
    });

    it('4. throws NotFoundError(\'audio-file\', filePath) when the file is missing on disk (W-fs-stat-enoent)', async () => {
      const storage = new FsAudioStorage(makeConfig(root));

      // ENOENT must surface as a NotFoundError so the global filter emits
      // the canonical NOT_FOUND envelope (REQ-PLAY-001 404 path covers
      // "track exists in DB but file missing on disk"). A bare ENOENT
      // would bubble as an undocumented 500.
      const missing = 'no/such/track.mp3';
      await expect(storage.stat(missing)).rejects.toThrow(NotFoundError);
      await expect(storage.stat(missing)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('5. open(filePath, null) returns a Readable whose bytes match the file content', async () => {
      await fs.mkdir(join(root, 'album'));
      const payload = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256));
      await fs.writeFile(join(root, 'album', 'track.mp3'), payload);

      const storage = new FsAudioStorage(makeConfig(root));

      const stream = storage.open('album/track.mp3', null);
      const drained = await drainStream(stream);

      expect(drained.equals(payload)).toBe(true);
    });

    it('5b. open(filePath, {start,end}) returns ONLY the requested byte range', async () => {
      // Partial-content (206) path — createReadStream's {start, end} opts.
      await fs.mkdir(join(root, 'album'));
      const payload = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256));
      await fs.writeFile(join(root, 'album', 'track.mp3'), payload);

      const storage = new FsAudioStorage(makeConfig(root));

      const stream = storage.open('album/track.mp3', { start: 100, end: 1123 });
      const drained = await drainStream(stream);

      // end is INCLUSIVE (RFC 7233) — 1123 - 100 + 1 = 1024 bytes.
      expect(drained.length).toBe(1024);
      expect(drained.equals(payload.subarray(100, 1124))).toBe(true);
    });
  });

  describe('mid-flight stream error handling (W-stream-errors)', () => {
    it('attaches an error listener so a destroyed source does not crash the process', async () => {
      // The 'error' listener is what prevents an unhandled 'error' event
      // from crashing Node when a mid-flight read failure happens after
      // headers are already flushed. We verify the listener is wired by
      // emitting an 'error' event on a stream we control — no process
      // crash means the contract holds.
      const storage = new FsAudioStorage(makeConfig(root));
      const stream = storage.open('any.mp3', null) as unknown as PassThrough;

      // The listener MUST have been attached; emitting 'error' must not
      // throw synchronously and must not crash the test runner.
      expect(() => stream.emit('error', new Error('synthetic mid-flight failure'))).not.toThrow();
    });
  });
});

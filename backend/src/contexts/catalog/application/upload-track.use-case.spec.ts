import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseBuffer } from 'music-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveDeterministicId } from '../../../shared/audio-meta';
import { ValidationError } from '../../../shared/errors/validation-error';
import type { AudioFileWriterPort } from '../domain/ports/audio-file-writer.port';
import type { CatalogEntryInput, CatalogRepositoryPort } from '../domain/ports/catalog-repository.port';
import { UploadTrackUseCase } from './upload-track.use-case';

// Module-boundary mock: every import of `music-metadata` inside the use
// case resolves to this vi.fn(), so tag behavior is driven by canned
// payloads instead of real audio bytes (mirrors `seed.spec.ts` — same
// technique, same reason: fallback branches need controlled tags).
vi.mock('music-metadata', () => ({ parseBuffer: vi.fn() }));
const parseBufferMock = vi.mocked(parseBuffer);

/**
 * UploadTrackUseCase unit specs (REQ-UPLOAD-001 … REQ-UPLOAD-004) against
 * port FAKES — no Prisma, no filesystem, no NestJS.
 *
 * Focus:
 *  - id derivation is BYTE-IDENTICAL to the seeder helpers for the same
 *    input (one pinned vector: the expected ids are computed in-spec via
 *    the shared kernel, which `prisma/seed.ts` re-exports — an upload and
 *    a re-seed MUST converge on the same rows);
 *  - the seeder's tag-fallback chain (no tags → filename parse →
 *    Singles / Unknown Artist; unparsable bytes → same degradation);
 *  - idempotent re-upload (same derived path ⇒ same ids ⇒ writer +
 *    upsert repeat with identical arguments);
 *  - path-traversal filenames are REJECTED before any port is touched.
 *
 * The e2e spec (`test/e2e/upload.e2e-spec.ts`) proves the same pipeline
 * over real HTTP + a real container; here the ports are fakes.
 */

/** Minimal `common`/`format` payload shaped like music-metadata's result. */
function makeTags(commonOverrides: Record<string, unknown> = {}, duration?: number) {
  return {
    common: {
      artist: undefined,
      album: undefined,
      title: undefined,
      year: undefined,
      date: undefined,
      track: { no: null, of: null },
      ...commonOverrides,
    },
    format: { duration },
  };
}

/** In-memory fake of the writer driven port — records every write. */
class InMemoryWriter implements AudioFileWriterPort {
  readonly writes: Array<{ relativePath: string; bytes: Buffer }> = [];
  async writeFile(relativePath: string, bytes: Buffer): Promise<void> {
    this.writes.push({ relativePath, bytes });
  }
}

function buildUseCase() {
  const writer = new InMemoryWriter();
  const upsert = vi.fn<(entry: CatalogEntryInput) => Promise<void>>();
  const catalog = { upsertCatalogEntry: upsert } as unknown as CatalogRepositoryPort;
  return { useCase: new UploadTrackUseCase(catalog, writer), writer, upsert };
}

const BYTES = readFileSync(resolve(__dirname, '../../../../test/fixtures/audio/sample.mp3'));

describe('UploadTrackUseCase', () => {
  beforeEach(() => {
    parseBufferMock.mockReset();
  });

  describe('happy path (tags present)', () => {
    it('writes the sanitized relative path and upserts seeder-identical ids', async () => {
      parseBufferMock.mockResolvedValue(
        makeTags(
          { artist: 'Kendrick Lamar', album: 'GNX', title: 'tv off', year: 2024, track: { no: 7, of: 12 } },
          218.6,
        ) as Awaited<ReturnType<typeof parseBuffer>>,
      );
      const { useCase, writer, upsert } = buildUseCase();

      const result = await useCase.execute({
        originalFilename: 'Kendrick Lamar - tv off.flac',
        bytes: BYTES,
      });

      // The pinned vector — expected ids computed with the SAME helpers the
      // seeder uses (shared kernel), proving upload/re-seed convergence.
      const expectedArtistId = deriveDeterministicId('artist:Kendrick Lamar');
      const expectedAlbumId = deriveDeterministicId(`album:${expectedArtistId}:GNX`);
      const expectedTrackId = deriveDeterministicId('track:Kendrick Lamar - tv off.flac');

      expect(writer.writes).toEqual([
        { relativePath: 'Kendrick Lamar - tv off.flac', bytes: BYTES },
      ]);
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith({
        artist: { id: expectedArtistId, name: 'Kendrick Lamar' },
        album: { id: expectedAlbumId, title: 'GNX', releaseYear: 2024, artistId: expectedArtistId },
        track: {
          id: expectedTrackId,
          title: 'tv off',
          durationSeconds: 219,
          filePath: '/audio/Kendrick Lamar - tv off.flac',
          trackNumber: 7,
          albumId: expectedAlbumId,
        },
      });
      expect(result).toEqual({
        track: {
          id: expectedTrackId,
          title: 'tv off',
          durationSeconds: 219,
          albumId: expectedAlbumId,
        },
        artist: { id: expectedArtistId, name: 'Kendrick Lamar' },
        album: { id: expectedAlbumId, title: 'GNX' },
      });
      // Contract guard: no storage path leaks into the HTTP-facing result.
      expect(JSON.stringify(result)).not.toContain('filePath');
      expect(JSON.stringify(result)).not.toContain('/audio/');
    });
  });

  describe('tag fallbacks (seeder parity)', () => {
    it('falls back to the filename split, Singles and Unknown Artist when tags are empty', async () => {
      parseBufferMock.mockResolvedValue(makeTags() as Awaited<ReturnType<typeof parseBuffer>>);
      const { useCase, upsert } = buildUseCase();

      // `A - B - C.flac` splits on the FIRST separator only: artist A,
      // title "B - C" (seeder fallback contract).
      const result = await useCase.execute({ originalFilename: 'A - B - C.flac', bytes: BYTES });

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          artist: expect.objectContaining({ name: 'A' }),
          album: expect.objectContaining({ title: 'Singles', releaseYear: null }),
          track: expect.objectContaining({
            title: 'B - C',
            durationSeconds: 1,
            trackNumber: 1,
            filePath: '/audio/A - B - C.flac',
          }),
        }),
      );
      expect(result.artist.name).toBe('A');
      expect(result.album.title).toBe('Singles');
      expect(result.track.title).toBe('B - C');
    });

    it('falls back to Unknown Artist when the filename has no " - " separator', async () => {
      parseBufferMock.mockResolvedValue(makeTags() as Awaited<ReturnType<typeof parseBuffer>>);
      const { useCase, upsert } = buildUseCase();

      const result = await useCase.execute({ originalFilename: 'song.flac', bytes: BYTES });

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          artist: expect.objectContaining({ name: 'Unknown Artist' }),
          album: expect.objectContaining({ title: 'Singles' }),
          track: expect.objectContaining({ title: 'song' }),
        }),
      );
      expect(result.artist.name).toBe('Unknown Artist');
      expect(result.track.title).toBe('song');
    });

    it('degrades to filename fallbacks when the bytes fail to parse (corrupt file)', async () => {
      parseBufferMock.mockRejectedValue(new Error('Guessed MIME type not supported'));
      const { useCase, writer, upsert } = buildUseCase();

      // Unparsable bytes are NOT a rejection — the file still lands in the
      // library with the 1s duration floor, mirroring the seeder's
      // scanAudioFiles degradation.
      const result = await useCase.execute({
        originalFilename: 'Weird Al - Dare to Be Stupid.mp3',
        bytes: Buffer.from('not audio at all'),
      });

      expect(writer.writes).toHaveLength(1);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          artist: expect.objectContaining({ name: 'Weird Al' }),
          track: expect.objectContaining({ title: 'Dare to Be Stupid', durationSeconds: 1 }),
        }),
      );
      expect(result.track.durationSeconds).toBe(1);
    });
  });

  describe('idempotent re-upload (REQ-UPLOAD-004)', () => {
    it('re-executing with the same file repeats writer + upsert with identical arguments', async () => {
      parseBufferMock.mockResolvedValue(
        makeTags({ artist: 'Björk', title: 'Jóga' }, 312.4) as Awaited<
          ReturnType<typeof parseBuffer>
        >,
      );
      const { useCase, writer, upsert } = buildUseCase();
      const input = { originalFilename: 'Björk - Jóga.flac', bytes: BYTES };

      const first = await useCase.execute(input);
      const second = await useCase.execute(input);

      // Same derived path ⇒ same ids ⇒ the response is byte-identical.
      expect(second).toEqual(first);
      expect(writer.writes).toHaveLength(2);
      expect(writer.writes[0]).toEqual(writer.writes[1]);
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert.mock.calls[0]).toEqual(upsert.mock.calls[1]);
    });
  });

  describe('filename sanitization + path traversal (REQ-UPLOAD-003)', () => {
    it('REJECTS a filename containing forward-slash traversal before touching any port', async () => {
      const { useCase, writer, upsert } = buildUseCase();

      await expect(
        useCase.execute({ originalFilename: '../../etc/passwd.mp3', bytes: BYTES }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(writer.writes).toEqual([]);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('REJECTS a filename containing backslash traversal', async () => {
      const { useCase, writer, upsert } = buildUseCase();

      await expect(
        useCase.execute({ originalFilename: '..\\..\\windows\\system32\\evil.wav', bytes: BYTES }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(writer.writes).toEqual([]);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('REJECTS a filename that sanitizes to the empty string', async () => {
      const { useCase, writer, upsert } = buildUseCase();

      // Every character is filesystem-reserved — nothing survives.
      await expect(useCase.execute({ originalFilename: '???', bytes: BYTES })).rejects.toBeInstanceOf(
        ValidationError,
      );

      expect(writer.writes).toEqual([]);
      expect(upsert).not.toHaveBeenCalled();
    });

    it('sanitizes hostile characters while preserving spaces, dashes and unicode', async () => {
      parseBufferMock.mockResolvedValue(makeTags() as Awaited<ReturnType<typeof parseBuffer>>);
      const { useCase, writer } = buildUseCase();

      // Control characters + reserved characters collapse; the ` - `
      // naming convention and `é` survive so the derived path stays
      // human-readable and seeder-compatible.
      await useCase.execute({ originalFilename: 'Bublé :  Sway\n.flac', bytes: BYTES });

      expect(writer.writes).toHaveLength(1);
      expect(writer.writes[0]!.relativePath).toBe('Bublé Sway.flac');
    });
  });
});

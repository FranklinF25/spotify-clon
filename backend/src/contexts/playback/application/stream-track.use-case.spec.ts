import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { Track } from '../../catalog/domain/track.entity';
import { NotFoundError } from '../../../shared/errors/not-found-error';
import type { AudioStoragePort } from '../domain/ports/audio-storage.port';
import type { CatalogRepositoryPort } from '../domain/ports/catalog-repo.port';
import type { RangeParserPort } from '../domain/ports/range-parser.port';
import type { RangeParseResult, StreamResult } from '../domain/types';
import { StreamTrackUseCase } from './stream-track.use-case';

/**
 * Unit spec for `StreamTrackUseCase` (PB-PR1-12).
 *
 * Covers REQ-PLAY-002 — the 6 status-code paths the use case discriminates:
 *
 *   1. missing track       → throws NotFoundError('track', id) (HTTP 404)
 *   2. full (no Range)     → { status: 200, result.kind: 'full' }
 *   3. partial (Range sat) → { status: 206, result.kind: 'partial' }
 *   4. unsatisfiable       → { status: 416, total } (NO result key)
 *   5. invalid syntax      → { status: 400, reason: 'invalid' }
 *   6. multi-range         → { status: 400, reason: 'multi-range' }
 *
 * All three driven collaborators (`CatalogRepositoryPort`, `AudioStoragePort`,
 * `RangeParserPort`) are mocked via `vi.fn()` returning controlled values —
 * the use case is exercised in pure application-layer isolation, NO
 * filesystem and NO HTTP.
 */
function makeTrack(overrides: Partial<Track> = {}): Track {
  return Track.reconstruct({
    id: 'track-1',
    title: 'Sample Track',
    durationSeconds: 180,
    filePath: '/audio/album/track-1.mp3',
    trackNumber: 1,
    albumId: 'album-1',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  });
}

function makeStream(): PassThrough {
  // A PassThrough stands in for a real Readable — the use case does not
  // read from it, it only forwards it inside the StreamResult.
  return new PassThrough();
}

function setup(overrides?: {
  catalog?: Partial<CatalogRepositoryPort>;
  storage?: Partial<AudioStoragePort>;
  rangeParser?: Partial<RangeParserPort>;
}) {
  const track = makeTrack();
  const stream = makeStream();

  const catalog: CatalogRepositoryPort = {
    findTrackById: vi
      .fn<[{ id: string }], Promise<Track | null>>()
      .mockResolvedValue(track),
    findTrackByIds: vi.fn().mockResolvedValue([]),
    findArtistById: vi.fn().mockResolvedValue(null),
    findAlbumById: vi.fn().mockResolvedValue(null),
    listArtists: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listAlbums: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    search: vi.fn().mockResolvedValue({ artists: [], albums: [], tracks: [] }),
    ...overrides?.catalog,
  };

  const storage: AudioStoragePort = {
    stat: vi.fn().mockResolvedValue({ size: 2048, contentType: 'audio/mpeg' }),
    open: vi.fn().mockReturnValue(stream),
    ...overrides?.storage,
  };

  const rangeParser: RangeParserPort = {
    parse: vi
      .fn<[number, string | undefined], RangeParseResult>()
      .mockReturnValue({ ok: true, range: null }),
    ...overrides?.rangeParser,
  };

  const useCase = new StreamTrackUseCase(catalog, storage, rangeParser);
  return { useCase, catalog, storage, rangeParser, track, stream };
}

describe('StreamTrackUseCase', () => {
  describe('REQ-PLAY-002 — status-code paths', () => {
    it('1. throws NotFoundError (code NOT_FOUND, status 404) when the track is missing', async () => {
      const { useCase } = setup({
        catalog: {
          findTrackById: vi.fn().mockResolvedValue(null),
        },
      });

      await expect(useCase.execute('nope', undefined)).rejects.toBeInstanceOf(NotFoundError);
      await expect(useCase.execute('nope', undefined)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('1b. NotFoundError carries the entity tag "track" and the requested id', async () => {
      const { useCase } = setup({
        catalog: { findTrackById: vi.fn().mockResolvedValue(null) },
      });

      try {
        await useCase.execute('missing-id', undefined);
        throw new Error('expected execute to throw NotFoundError');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundError);
        expect((err as Error).message).toContain('track');
        expect((err as Error).message).toContain('missing-id');
      }
    });

    it('2. returns { status: 200, result.kind: "full" } when no Range header is present', async () => {
      const { useCase, storage, stream } = setup({
        storage: {
          // FLAC fixture — proves the stat-reported contentType flows into
          // the 'full' StreamResult verbatim (REQ-PLAY-005 content-type fix).
          stat: vi.fn().mockResolvedValue({ size: 2048, contentType: 'audio/flac' }),
        },
        rangeParser: {
          parse: vi.fn().mockReturnValue({ ok: true, range: null }),
        },
      });

      const outcome = await useCase.execute('track-1', undefined);

      expect(outcome.status).toBe(200);
      if (outcome.status !== 200) throw new Error('narrow');
      const result = outcome.result as StreamResult;
      expect(result.kind).toBe('full');
      if (result.kind !== 'full') throw new Error('narrow');
      expect(result.total).toBe(2048);
      expect(result.contentType).toBe('audio/flac');
      expect(result.stream).toBe(stream);
      // open() called with null range → full-content stream.
      expect(storage.open).toHaveBeenCalledWith('/audio/album/track-1.mp3', null);
    });

    it('3. returns { status: 206, result.kind: "partial" } when the range is satisfiable', async () => {
      const { useCase, storage, stream } = setup({
        storage: {
          stat: vi.fn().mockResolvedValue({ size: 2048, contentType: 'audio/ogg' }),
        },
        rangeParser: {
          parse: vi.fn().mockReturnValue({
            ok: true,
            range: { start: 0, end: 1023, total: 2048 },
          }),
        },
      });

      const outcome = await useCase.execute('track-1', 'bytes=0-1023');

      expect(outcome.status).toBe(206);
      if (outcome.status !== 206) throw new Error('narrow');
      const result = outcome.result as StreamResult;
      expect(result.kind).toBe('partial');
      if (result.kind !== 'partial') throw new Error('narrow');
      expect(result.range).toEqual({ start: 0, end: 1023, total: 2048 });
      expect(result.contentType).toBe('audio/ogg');
      expect(result.stream).toBe(stream);
      // open() called with the parsed {start, end} → partial stream.
      expect(storage.open).toHaveBeenCalledWith('/audio/album/track-1.mp3', {
        start: 0,
        end: 1023,
      });
    });

    it('4. returns { status: 416, total } (NO result key) when the range is unsatisfiable', async () => {
      const { useCase, storage } = setup({
        rangeParser: {
          parse: vi.fn().mockReturnValue({
            ok: false,
            reason: 'unsatisfiable',
            total: 2048,
          }),
        },
      });

      const outcome = await useCase.execute('track-1', 'bytes=999999-');

      expect(outcome).toEqual({ status: 416, total: 2048 });
      // The 416 branch MUST NOT open a stream — no bytes are sent.
      expect(storage.open).not.toHaveBeenCalled();
    });

    it('5. returns { status: 400, reason: "invalid" } (NO result key) when the header is syntactically invalid', async () => {
      const { useCase, storage } = setup({
        rangeParser: {
          parse: vi.fn().mockReturnValue({ ok: false, reason: 'invalid' }),
        },
      });

      const outcome = await useCase.execute('track-1', 'bytes=abc');

      expect(outcome).toEqual({ status: 400, reason: 'invalid' });
      expect(storage.open).not.toHaveBeenCalled();
    });

    it('6. returns { status: 400, reason: "multi-range" } (NO result key) when the client requests multiple ranges', async () => {
      const { useCase, storage } = setup({
        rangeParser: {
          parse: vi.fn().mockReturnValue({ ok: false, reason: 'multi-range' }),
        },
      });

      const outcome = await useCase.execute('track-1', 'bytes=0-10,20-30');

      expect(outcome).toEqual({ status: 400, reason: 'multi-range' });
      expect(storage.open).not.toHaveBeenCalled();
    });
  });

  describe('collaborator orchestration contract', () => {
    it('queries catalog with the requested trackId', async () => {
      const { useCase, catalog } = setup();

      await useCase.execute('track-1', undefined);

      expect(catalog.findTrackById).toHaveBeenCalledWith('track-1');
    });

    it('stats the track.filePath returned by the catalog (not the id)', async () => {
      const { useCase, storage, track } = setup();

      await useCase.execute('track-1', undefined);

      expect(storage.stat).toHaveBeenCalledWith(track.filePath);
    });

    it('passes the file size and the raw Range header to the range parser', async () => {
      const { useCase, rangeParser } = setup({
        storage: { stat: vi.fn().mockResolvedValue({ size: 4096, contentType: 'audio/mpeg' }) },
      });

      await useCase.execute('track-1', 'bytes=0-1023');

      expect(rangeParser.parse).toHaveBeenCalledWith(4096, 'bytes=0-1023');
    });
  });
});

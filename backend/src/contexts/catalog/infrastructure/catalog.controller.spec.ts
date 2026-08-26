import { describe, expect, it, vi } from 'vitest';

import { Artist } from '../domain/artist.entity';
import { Album } from '../domain/album.entity';
import { Track } from '../domain/track.entity';
import { GetAlbumUseCase } from '../application/get-album.use-case';
import { GetArtistUseCase } from '../application/get-artist.use-case';
import { GetTrackUseCase } from '../application/get-track.use-case';
import { ListAlbumsUseCase } from '../application/list-albums.use-case';
import { ListArtistsUseCase } from '../application/list-artists.use-case';
import { SearchCatalogUseCase } from '../application/search-catalog.use-case';
import { UploadTrackUseCase } from '../application/upload-track.use-case';
import { ValidationError } from '../../../shared/errors/validation-error';
import { CatalogController } from './catalog.controller';
import * as validatePaginationModule from './dto/validate-pagination';
import * as validateSearchModule from './dto/validate-search';

/**
 * CatalogController unit specs (CAT-PR2b1-05 + CAT-PR3c-03).
 *
 * supertest-free: each route is exercised by injecting mocked use cases
 * (vi.fn()) and asserting the controller:
 *  - calls the right use case with the right arguments;
 *  - returns the expected projection (read-model → HTTP shape);
 *  - drops `filePath` from every response (R4 guard);
 *  - calls the `validatePagination` / `validateSearch` wrappers (NOT raw
 *    validate()) so the spec-pinned `INVALID_PAGINATION` / `INVALID_QUERY`
 *    tokens surface on bad input (R3-W-3 lesson — wrappers translate Zod
 *    issues into spec-pinned error codes).
 *
 * The e2e specs (PR-2b2 + PR-3c) cover the HTTP/JWT contract end-to-end.
 */
describe('CatalogController', () => {
  const epoch = new Date('2025-01-01T00:00:00.000Z');

  function buildController(_overrides: {
    listArtists?: Partial<ListArtistsUseCase>;
    getArtist?: Partial<GetArtistUseCase>;
    listAlbums?: Partial<ListAlbumsUseCase>;
    getAlbum?: Partial<GetAlbumUseCase>;
    getTrack?: Partial<GetTrackUseCase>;
    search?: Partial<SearchCatalogUseCase>;
    upload?: Partial<UploadTrackUseCase>;
  } = {}) {
    const listArtists = { execute: vi.fn() } as unknown as ListArtistsUseCase;
    const getArtist = { execute: vi.fn() } as unknown as GetArtistUseCase;
    const listAlbums = { execute: vi.fn() } as unknown as ListAlbumsUseCase;
    const getAlbum = { execute: vi.fn() } as unknown as GetAlbumUseCase;
    const getTrack = { execute: vi.fn() } as unknown as GetTrackUseCase;
    const search = { execute: vi.fn() } as unknown as SearchCatalogUseCase;
    const upload = { execute: vi.fn() } as unknown as UploadTrackUseCase;
    return {
      controller: new CatalogController(listArtists, getArtist, listAlbums, getAlbum, getTrack, search, upload),
      mocks: { listArtists, getArtist, listAlbums, getAlbum, getTrack, search, upload },
    };
  }

  describe('GET /artists', () => {
    it('calls validatePagination then ListArtistsUseCase and returns the paginated envelope', async () => {
      const { controller, mocks } = buildController();
      const spy = vi
        .spyOn(validatePaginationModule, 'validatePagination')
        .mockReturnValue({ page: 2, pageSize: 5 });
      mocks.listArtists.execute.mockResolvedValue({
        items: [{ id: 'a1', name: 'Artist One' }],
        page: 2,
        pageSize: 5,
        total: 1,
      });

      const result = await controller.listArtists({ page: '2', pageSize: '5' });

      expect(spy).toHaveBeenCalledWith({ page: '2', pageSize: '5' });
      expect(mocks.listArtists.execute).toHaveBeenCalledWith({ page: 2, pageSize: 5 });
      expect(result).toEqual({
        items: [{ id: 'a1', name: 'Artist One' }],
        page: 2,
        pageSize: 5,
        total: 1,
      });
      spy.mockRestore();
    });
  });

  describe('GET /artists/:id', () => {
    it('returns artist projection + embedded album summaries', async () => {
      const { controller, mocks } = buildController();
      const artist = Artist.reconstruct({
        id: 'a1',
        name: 'Artist One',
        bio: 'Singer',
        imageUrl: null,
        createdAt: epoch,
      });
      mocks.getArtist.execute.mockResolvedValue({
        artist,
        albums: [{ id: 'l1', title: 'Album One', releaseYear: 2024, coverUrl: null, artist: { id: 'a1', name: 'Artist One' } }],
      });

      const result = await controller.artist('a1');

      expect(mocks.getArtist.execute).toHaveBeenCalledWith({ id: 'a1' });
      expect(result).toEqual({
        id: 'a1',
        name: 'Artist One',
        bio: 'Singer',
        imageUrl: null,
        albums: [
          {
            id: 'l1',
            title: 'Album One',
            releaseYear: 2024,
            coverUrl: null,
            artist: { id: 'a1', name: 'Artist One' },
          },
        ],
      });
    });
  });

  describe('GET /albums', () => {
    it('calls validatePagination then ListAlbumsUseCase', async () => {
      const { controller, mocks } = buildController();
      const spy = vi
        .spyOn(validatePaginationModule, 'validatePagination')
        .mockReturnValue({ page: 1, pageSize: 20 });
      mocks.listAlbums.execute.mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      });

      const result = await controller.listAlbums({});

      expect(spy).toHaveBeenCalledWith({});
      expect(mocks.listAlbums.execute).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
      expect(result.total).toBe(0);
      spy.mockRestore();
    });
  });

  describe('GET /albums/:id', () => {
    it('returns album projection + artist summary + tracks as primitives', async () => {
      const { controller, mocks } = buildController();
      const album = Album.reconstruct({
        id: 'l1',
        title: 'Album One',
        releaseYear: 2024,
        coverUrl: null,
        artistId: 'a1',
        createdAt: epoch,
      });
      const track = Track.reconstruct({
        id: 't1',
        title: 'Track One',
        durationSeconds: 213,
        filePath: '/storage/secret.mp3',
        trackNumber: 1,
        albumId: 'l1',
        createdAt: epoch,
      });
      mocks.getAlbum.execute.mockResolvedValue({
        album,
        artist: { id: 'a1', name: 'Artist One' },
        tracks: [track],
      });

      const result = await controller.album('l1');

      expect(mocks.getAlbum.execute).toHaveBeenCalledWith({ id: 'l1' });
      expect(result).toEqual({
        id: 'l1',
        title: 'Album One',
        releaseYear: 2024,
        coverUrl: null,
        artistId: 'a1',
        artist: { id: 'a1', name: 'Artist One' },
        tracks: [
          {
            id: 't1',
            title: 'Track One',
            durationSeconds: 213,
            trackNumber: 1,
            albumId: 'l1',
          },
        ],
      });
      // R4 guard: filePath must NEVER leak in any controller response.
      expect(JSON.stringify(result)).not.toContain('filePath');
      expect(JSON.stringify(result)).not.toContain('/storage/secret.mp3');
    });
  });

  describe('GET /tracks/:id', () => {
    it('returns the track projection WITHOUT filePath (R4 guard)', async () => {
      const { controller, mocks } = buildController();
      const track = Track.reconstruct({
        id: 't1',
        title: 'Track One',
        durationSeconds: 213,
        filePath: '/storage/secret.mp3',
        trackNumber: 1,
        albumId: 'l1',
        createdAt: epoch,
      });
      mocks.getTrack.execute.mockResolvedValue(track);

      const result = await controller.track('t1');

      expect(mocks.getTrack.execute).toHaveBeenCalledWith({ id: 't1' });
      expect(result).toEqual({
        id: 't1',
        title: 'Track One',
        durationSeconds: 213,
        trackNumber: 1,
        albumId: 'l1',
      });
      // The exact keys — filePath MUST NOT be among them.
      expect(Object.keys(result).sort()).toEqual(
        ['albumId', 'durationSeconds', 'id', 'title', 'trackNumber'].sort(),
      );
    });
  });

  describe('GET /search', () => {
    it('calls validateSearch then SearchCatalogUseCase and returns the grouped result', async () => {
      const { controller, mocks } = buildController();
      // The controller MUST call `validateSearch` (the wrapper), NOT raw
      // `validate()` — only the wrapper re-throws Zod issues as
      // `InvalidQueryError` so the spec-pinned `INVALID_QUERY` token
      // reaches the client (R3-W-3 lesson applied to R6).
      const spy = vi
        .spyOn(validateSearchModule, 'validateSearch')
        .mockReturnValue({ q: 'foo' });
      mocks.search.execute.mockResolvedValue({
        artists: [{ id: 'a1', name: 'Foo Artist' }],
        albums: [
          {
            id: 'l1',
            title: 'Foo Album',
            releaseYear: 2024,
            coverUrl: null,
            artist: { id: 'a1', name: 'Foo Artist' },
          },
        ],
        tracks: [
          {
            id: 't1',
            title: 'Foo Track',
            durationSeconds: 213,
            albumId: 'l1',
          },
        ],
      });

      const result = await controller.search({ q: 'foo' });

      expect(spy).toHaveBeenCalledWith({ q: 'foo' });
      expect(mocks.search.execute).toHaveBeenCalledWith({ q: 'foo' });
      // The grouped SearchResult is returned directly — projections keep
      // `filePath` out of the response (R6 guard, no controller mapping).
      expect(result).toEqual({
        artists: [{ id: 'a1', name: 'Foo Artist' }],
        albums: [
          {
            id: 'l1',
            title: 'Foo Album',
            releaseYear: 2024,
            coverUrl: null,
            artist: { id: 'a1', name: 'Foo Artist' },
          },
        ],
        tracks: [
          {
            id: 't1',
            title: 'Foo Track',
            durationSeconds: 213,
            albumId: 'l1',
          },
        ],
      });
      // R4/R6 guard: filePath never appears anywhere in the response.
      expect(JSON.stringify(result)).not.toContain('filePath');
      spy.mockRestore();
    });

    it('forwards the type filter through validateSearch to the use case', async () => {
      const { controller, mocks } = buildController();
      const spy = vi
        .spyOn(validateSearchModule, 'validateSearch')
        .mockReturnValue({ q: 'foo', type: 'artist' });
      mocks.search.execute.mockResolvedValue({
        artists: [{ id: 'a1', name: 'Foo Artist' }],
        albums: [],
        tracks: [],
      });

      await controller.search({ q: 'foo', type: 'artist' });

      expect(spy).toHaveBeenCalledWith({ q: 'foo', type: 'artist' });
      expect(mocks.search.execute).toHaveBeenCalledWith({
        q: 'foo',
        type: 'artist',
      });
      spy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // POST /tracks/upload (REQ-UPLOAD-001 … REQ-UPLOAD-003).
  //
  // The multipart validation MATRIX splits by responsibility:
  //  - NO FILE (missing part / non-multipart body) → handler branch below;
  //  - WRONG EXTENSION → `UPLOAD_FILE_OPTIONS.fileFilter` (allowlist);
  //  - OVERSIZE → `UploadFileExceptionFilter` (multer LIMIT_FILE_SIZE map).
  // The last two run inside the interceptor/filter pipeline, so their unit
  // specs live next to those artifacts; the e2e spec drives all three over
  // real HTTP.
  // -------------------------------------------------------------------------
  describe('POST /tracks/upload', () => {
    it('throws VALIDATION_ERROR (field "file") when no file part is present', async () => {
      const { controller, mocks } = buildController();

      // undefined — no multipart body at all (interceptor skipped parsing).
      await expect(controller.upload(undefined)).rejects.toBeInstanceOf(ValidationError);
      await expect(controller.upload(undefined)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
        details: [{ field: 'file', issue: expect.stringContaining('multipart/form-data') }],
      });

      // The use case must never see a fileless request.
      expect(mocks.upload.execute).not.toHaveBeenCalled();
    });

    it('forwards originalFilename + bytes to UploadTrackUseCase and returns the 201 contract', async () => {
      const { controller, mocks } = buildController();
      const bytes = Buffer.from('fake-mp3-bytes');
      mocks.upload.execute.mockResolvedValue({
        track: { id: 't1', title: 'Song', durationSeconds: 42, albumId: 'l1' },
        artist: { id: 'a1', name: 'Artist One' },
        album: { id: 'l1', title: 'Singles' },
      });

      const result = await controller.upload({
        fieldname: 'file',
        originalname: 'Artist One - Song.mp3',
        encoding: '7bit',
        mimetype: 'audio/mpeg',
        buffer: bytes,
        size: bytes.length,
      } as Express.Multer.File);

      expect(mocks.upload.execute).toHaveBeenCalledWith({
        originalFilename: 'Artist One - Song.mp3',
        bytes,
      });
      // EXACT response contract (REQ-UPLOAD-001) — nothing more.
      expect(result).toEqual({
        track: { id: 't1', title: 'Song', durationSeconds: 42, albumId: 'l1' },
        artist: { id: 'a1', name: 'Artist One' },
        album: { id: 'l1', title: 'Singles' },
      });
      expect(Object.keys(result).sort()).toEqual(['album', 'artist', 'track']);
      // R4 guard: no storage path anywhere in the upload response.
      expect(JSON.stringify(result)).not.toContain('filePath');
    });
  });
});

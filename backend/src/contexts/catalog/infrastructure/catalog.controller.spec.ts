import { describe, expect, it, vi } from 'vitest';

import { Artist } from '../domain/artist.entity';
import { Album } from '../domain/album.entity';
import { Track } from '../domain/track.entity';
import { GetAlbumUseCase } from '../application/get-album.use-case';
import { GetArtistUseCase } from '../application/get-artist.use-case';
import { GetTrackUseCase } from '../application/get-track.use-case';
import { ListAlbumsUseCase } from '../application/list-albums.use-case';
import { ListArtistsUseCase } from '../application/list-artists.use-case';
import { CatalogController } from './catalog.controller';
import * as validatePaginationModule from './dto/validate-pagination';

/**
 * CatalogController unit specs (CAT-PR2b1-05).
 *
 * supertest-free: each route is exercised by injecting mocked use cases
 * (vi.fn()) and asserting the controller:
 *  - calls the right use case with the right arguments;
 *  - returns the expected projection (read-model → HTTP shape);
 *  - drops `filePath` from every response (R4 guard);
 *  - calls the `validatePagination` wrapper (NOT raw validate()) so the
 *    spec-pinned `INVALID_PAGINATION` token surfaces on bad input.
 *
 * The e2e specs (PR-2b2) cover the HTTP/JWT contract end-to-end.
 */
describe('CatalogController', () => {
  const epoch = new Date('2025-01-01T00:00:00.000Z');

  function buildController(_overrides: {
    listArtists?: Partial<ListArtistsUseCase>;
    getArtist?: Partial<GetArtistUseCase>;
    listAlbums?: Partial<ListAlbumsUseCase>;
    getAlbum?: Partial<GetAlbumUseCase>;
    getTrack?: Partial<GetTrackUseCase>;
  } = {}) {
    const listArtists = { execute: vi.fn() } as unknown as ListArtistsUseCase;
    const getArtist = { execute: vi.fn() } as unknown as GetArtistUseCase;
    const listAlbums = { execute: vi.fn() } as unknown as ListAlbumsUseCase;
    const getAlbum = { execute: vi.fn() } as unknown as GetAlbumUseCase;
    const getTrack = { execute: vi.fn() } as unknown as GetTrackUseCase;
    return {
      controller: new CatalogController(listArtists, getArtist, listAlbums, getAlbum, getTrack),
      mocks: { listArtists, getArtist, listAlbums, getAlbum, getTrack },
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
});

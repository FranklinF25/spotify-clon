import { describe, expect, it } from 'vitest';

import { NotFoundError } from '../../../shared/errors/not-found-error';
import {
  InMemoryCatalogRepository,
  buildAlbum,
  buildArtist,
  buildTrack,
} from '../../../../test/helpers/catalog-fakes';
import { GetAlbumUseCase } from './get-album.use-case';

/**
 * Unit spec for `GetAlbumUseCase` (CAT-PR2a-11).
 *
 * Underpins spec scenarios (R3):
 *   - "Album detail embeds tracks and artist" — non-empty tracks[] + artist summary
 *   - "Album not found" — 404 NOT_FOUND
 */
describe('GetAlbumUseCase', () => {
  function setup() {
    const catalog = new InMemoryCatalogRepository();
    catalog.seed({
      artists: [buildArtist({ id: 'artist-1', name: 'Artist One' })],
      albums: [buildAlbum({ id: 'album-1', title: 'Album One', artistId: 'artist-1' })],
      tracks: [
        buildTrack({ id: 'track-1', title: 'Track One', albumId: 'album-1', trackNumber: 1 }),
        buildTrack({ id: 'track-2', title: 'Track Two', albumId: 'album-1', trackNumber: 2 }),
        // A decoy track on a different album — MUST NOT appear.
        buildTrack({ id: 'track-x', title: 'Decoy', albumId: 'album-99', trackNumber: 1 }),
      ],
    });
    const useCase = new GetAlbumUseCase(catalog);
    return { useCase };
  }

  it('returns the album detail with embedded artist summary and tracks', async () => {
    const { useCase } = setup();

    const detail = await useCase.execute({ id: 'album-1' });

    expect(detail.album.id).toBe('album-1');
    expect(detail.album.title).toBe('Album One');
    expect(detail.artist).toEqual({ id: 'artist-1', name: 'Artist One' });
    expect(detail.tracks).toHaveLength(2);
  });

  it('returns a non-empty tracks array (spec-locked embedding)', async () => {
    const { useCase } = setup();

    const detail = await useCase.execute({ id: 'album-1' });

    expect(detail.tracks.length).toBeGreaterThan(0);
    expect(detail.tracks.map((t) => t.id).sort()).toEqual(['track-1', 'track-2']);
  });

  it('does not include tracks belonging to a different album', async () => {
    const { useCase } = setup();

    const detail = await useCase.execute({ id: 'album-1' });

    expect(detail.tracks.find((t) => t.id === 'track-x')).toBeUndefined();
  });

  it('throws NotFoundError (code NOT_FOUND, status 404) when the album is missing', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ id: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws a NotFoundError instance when the album is missing', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

import { describe, expect, it } from 'vitest';

import { NotFoundError } from '../../../shared/errors/not-found-error';
import {
  InMemoryCatalogRepository,
  buildAlbum,
  buildArtist,
} from '../../../../test/helpers/catalog-fakes';
import { GetArtistUseCase } from './get-artist.use-case';

/**
 * Unit spec for `GetArtistUseCase` (CAT-PR2a-09).
 *
 * Underpins spec scenarios (R2):
 *   - "Artist detail found" — returns { artist, albums }
 *   - "Artist not found" — 404 NOT_FOUND
 *
 * The fake embeds album summaries in `ArtistDetail` so this spec verifies the
 * compound shape round-trips too.
 */
describe('GetArtistUseCase', () => {
  function setup() {
    const catalog = new InMemoryCatalogRepository();
    const artist = buildArtist({ id: 'artist-1', name: 'Artist One' });
    const album1 = buildAlbum({ id: 'album-1', title: 'Album One', artistId: 'artist-1' });
    const album2 = buildAlbum({ id: 'album-2', title: 'Album Two', artistId: 'artist-1' });
    // A decoy album on a different artist — MUST NOT appear in artist-1's detail.
    const decoy = buildAlbum({ id: 'album-x', title: 'Decoy', artistId: 'artist-99' });
    catalog.seed({ artists: [artist], albums: [album1, album2, decoy] });
    const useCase = new GetArtistUseCase(catalog);
    return { useCase };
  }

  it('returns the artist detail with embedded album summaries', async () => {
    const { useCase } = setup();

    const detail = await useCase.execute({ id: 'artist-1' });

    expect(detail.artist.id).toBe('artist-1');
    expect(detail.artist.name).toBe('Artist One');
    expect(detail.albums).toHaveLength(2);
    expect(detail.albums.map((a) => a.id).sort()).toEqual(['album-1', 'album-2']);
  });

  it('embeds the artist summary inside each album summary', async () => {
    const { useCase } = setup();

    const detail = await useCase.execute({ id: 'artist-1' });

    for (const album of detail.albums) {
      expect(album.artist).toEqual({ id: 'artist-1', name: 'Artist One' });
    }
  });

  it('does not include albums belonging to a different artist', async () => {
    const { useCase } = setup();

    const detail = await useCase.execute({ id: 'artist-1' });

    expect(detail.albums.find((a) => a.id === 'album-x')).toBeUndefined();
  });

  it('throws NotFoundError (code NOT_FOUND, status 404) when the artist is missing', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ id: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws a NotFoundError instance (not a bare Error)', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

import { describe, expect, it } from 'vitest';

import { InvalidPaginationError } from '../../../shared/errors/invalid-pagination-error';
import {
  InMemoryCatalogRepository,
  buildAlbum,
  buildArtist,
} from '../../../../test/helpers/catalog-fakes';
import { ListAlbumsUseCase } from './list-albums.use-case';

/**
 * Unit spec for `ListAlbumsUseCase` (CAT-PR2a-10).
 *
 * Mirrors `ListArtistsUseCase` against `catalog.listAlbums`. Each album
 * summary MUST carry an embedded `artist: ArtistSummary`.
 */
describe('ListAlbumsUseCase', () => {
  function setup(count = 25) {
    const catalog = new InMemoryCatalogRepository();
    catalog.seed({
      artists: [buildArtist({ id: 'artist-1', name: 'Artist One' })],
      albums: Array.from({ length: count }, (_, i) =>
        buildAlbum({
          id: `album-${i + 1}`,
          title: `Album ${i + 1}`,
          artistId: 'artist-1',
        }),
      ),
    });
    const useCase = new ListAlbumsUseCase(catalog);
    return { useCase };
  }

  it('applies defaults (page=1, pageSize=20) when no input is given', async () => {
    const { useCase } = setup(25);

    const result = await useCase.execute({});

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(25);
    expect(result.items).toHaveLength(20);
  });

  it('honours an explicit page + pageSize', async () => {
    const { useCase } = setup(25);

    const result = await useCase.execute({ page: 2, pageSize: 5 });

    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toMatchObject({ id: 'album-6', title: 'Album 6' });
  });

  it('returns empty items with accurate total on an out-of-range page', async () => {
    const { useCase } = setup(5);

    const result = await useCase.execute({ page: 999 });

    expect(result.total).toBe(5);
    expect(result.items).toEqual([]);
  });

  it('each item carries an embedded artist summary', async () => {
    const { useCase } = setup(3);

    const result = await useCase.execute({});

    for (const album of result.items) {
      expect(album.artist).toEqual({ id: 'artist-1', name: 'Artist One' });
    }
  });

  it('rejects page=0 with InvalidPaginationError', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ page: 0 })).rejects.toBeInstanceOf(
      InvalidPaginationError,
    );
  });

  it('rejects pageSize=101 with InvalidPaginationError', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ pageSize: 101 })).rejects.toBeInstanceOf(
      InvalidPaginationError,
    );
  });
});

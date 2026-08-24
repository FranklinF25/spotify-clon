import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryCatalogRepository,
  buildAlbum,
  buildArtist,
} from '../../../../test/helpers/catalog-fakes';
import { InMemoryLibraryRepository } from '../../../../test/helpers/library-fakes';
import { ListLibraryUseCase } from './list-library.use-case';

/**
 * Unit spec for `ListLibraryUseCase` (F6 — REQ-L-003, design §11.1).
 *
 * The fake catalog's `findAlbumByIds` returns results in REVERSED insertion
 * order — these specs therefore pin the use case's defensive re-sort: recency
 * comes from the repo rows, never from the hydration source's return order.
 */
describe('ListLibraryUseCase', () => {
  function setup() {
    const library = new InMemoryLibraryRepository();
    const catalog = new InMemoryCatalogRepository();
    catalog.seed({
      artists: [buildArtist({ id: 'artist-1', name: 'Artist One' })],
      albums: [
        buildAlbum({ id: 'album-1', title: 'Album One', artistId: 'artist-1' }),
        buildAlbum({ id: 'album-2', title: 'Album Two', artistId: 'artist-1' }),
        buildAlbum({ id: 'album-3', title: 'Album Three', artistId: 'artist-1' }),
      ],
    });
    const logger = { warn: vi.fn() };
    const useCase = new ListLibraryUseCase(library, catalog, logger);
    return { useCase, library, catalog, logger };
  }

  const T1 = new Date('2025-06-01T00:00:00.000Z');
  const T2 = new Date('2025-06-02T00:00:00.000Z');
  const T3 = new Date('2025-06-03T00:00:00.000Z');

  it('returns hydrated entries ordered by repo recency regardless of the catalog return order', async () => {
    const { useCase, library } = setup();
    // Saved A1, then A2, then A3 → recency [A3, A2, A1]. The fake catalog
    // hydrates in REVERSED seed order ([A3, A2, A1] → returns [A1, A2, A3]?
    // reversed of filter order) — the use case must not care.
    library.seed({
      userId: 'user-1',
      rows: [
        { albumId: 'album-1', addedAt: T1 },
        { albumId: 'album-2', addedAt: T2 },
        { albumId: 'album-3', addedAt: T3 },
      ],
    });

    const result = await useCase.execute({ userId: 'user-1' });

    expect(result.map((s) => s.album.id)).toEqual(['album-3', 'album-2', 'album-1']);
    expect(result[0].album.title).toBe('Album Three');
    expect(result[0].album.artist).toEqual({ id: 'artist-1', name: 'Artist One' });
    expect(result[0].addedAt).toBe(T3);
  });

  it('returns only the caller rows (two-user isolation)', async () => {
    const { useCase, library } = setup();
    library.seed({
      userId: 'user-1',
      rows: [{ albumId: 'album-1', addedAt: T1 }],
    });
    library.seed({
      userId: 'user-2',
      rows: [
        { albumId: 'album-2', addedAt: T2 },
        { albumId: 'album-3', addedAt: T3 },
      ],
    });

    const result = await useCase.execute({ userId: 'user-1' });

    expect(result.map((s) => s.album.id)).toEqual(['album-1']);
  });

  it('returns [] for a user with no saved albums', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({ userId: 'user-fresh' });

    expect(result).toEqual([]);
  });

  it('silently omits broken references and warns with the pinned shape', async () => {
    const { library, logger } = setup();
    // One broken ref of three: album-2 never seeded in the catalog.
    const broken = new InMemoryCatalogRepository();
    broken.seed({
      artists: [buildArtist({ id: 'artist-1', name: 'Artist One' })],
      albums: [
        buildAlbum({ id: 'album-1', title: 'Album One', artistId: 'artist-1' }),
        buildAlbum({ id: 'album-3', title: 'Album Three', artistId: 'artist-1' }),
      ],
    });
    const use = new ListLibraryUseCase(library, broken, logger);
    library.seed({
      userId: 'user-1',
      rows: [
        { albumId: 'album-1', addedAt: T1 },
        { albumId: 'album-2', addedAt: T2 },
        { albumId: 'album-3', addedAt: T3 },
      ],
    });

    const result = await use.execute({ userId: 'user-1' });

    expect(result.map((s) => s.album.id)).toEqual(['album-3', 'album-1']);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Library hydration omitted unresolved album references',
      { userId: 'user-1', omittedAlbumIds: ['album-2'], count: 1 },
    );
  });

  it('does not warn when every reference resolves', async () => {
    const { useCase, library, logger } = setup();
    library.seed({
      userId: 'user-1',
      rows: [{ albumId: 'album-1', addedAt: T1 }],
    });

    await useCase.execute({ userId: 'user-1' });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

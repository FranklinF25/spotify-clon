import { describe, expect, it, vi } from 'vitest';

import { InMemoryLibraryRepository } from '../../../../test/helpers/library-fakes';
import { RemoveAlbumFromLibraryUseCase } from './remove-album-from-library.use-case';

/**
 * Unit spec for `RemoveAlbumFromLibraryUseCase` (F6 — REQ-L-004, design §11.1).
 *
 * Happy: calls `removeAlbum` with the caller's pair. Edge: a not-saved pair
 * still resolves with no error (idempotent regardless of catalog state —
 * NO catalog call, NO existence check).
 */
describe('RemoveAlbumFromLibraryUseCase', () => {
  function setup() {
    const library = new InMemoryLibraryRepository();
    return {
      useCase: new RemoveAlbumFromLibraryUseCase(library),
      library,
    };
  }

  it('calls removeAlbum with the caller userId + albumId', async () => {
    const { useCase, library } = setup();
    const removeSpy = vi.spyOn(library, 'removeAlbum');

    await useCase.execute({ userId: 'user-1', albumId: 'album-1' });

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith({ userId: 'user-1', albumId: 'album-1' });
  });

  it('removing a saved album deletes the row', async () => {
    const { useCase, library } = setup();
    library.seed({
      userId: 'user-1',
      rows: [{ albumId: 'album-1', addedAt: new Date('2025-06-01T00:00:00.000Z') }],
    });

    await useCase.execute({ userId: 'user-1', albumId: 'album-1' });

    expect(await library.listByUser('user-1')).toEqual([]);
  });

  it('removing a not-saved pair resolves with no error (REQ-L-004 idempotent)', async () => {
    const { useCase, library } = setup();

    await expect(
      useCase.execute({ userId: 'user-1', albumId: 'album-9' }),
    ).resolves.toBeUndefined();

    expect(await library.listByUser('user-1')).toEqual([]);
  });

  it('one user removal never touches another user row', async () => {
    const { useCase, library } = setup();
    const AT = new Date('2025-06-01T00:00:00.000Z');
    library.seed({ userId: 'user-1', rows: [{ albumId: 'album-1', addedAt: AT }] });
    library.seed({ userId: 'user-2', rows: [{ albumId: 'album-1', addedAt: AT }] });

    await useCase.execute({ userId: 'user-1', albumId: 'album-1' });

    expect(await library.listByUser('user-1')).toEqual([]);
    expect(await library.listByUser('user-2')).toEqual([{ albumId: 'album-1', addedAt: AT }]);
  });
});

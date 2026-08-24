import { describe, expect, it, vi } from 'vitest';

import { UnprocessableEntityError } from '../../../shared/errors/unprocessable-entity-error';
import {
  InMemoryCatalogRepository,
  buildAlbum,
  buildArtist,
} from '../../../../test/helpers/catalog-fakes';
import { InMemoryLibraryRepository } from '../../../../test/helpers/library-fakes';
import { AddAlbumToLibraryUseCase } from './add-album-to-library.use-case';

/**
 * Unit spec for `AddAlbumToLibraryUseCase` (F6 — REQ-L-002, design §11.1).
 *
 * Happy: first save calls `addAlbum` with the caller's id + `now`; re-save
 * still calls the upsert, never throws (LOCKED decision #3 at the unit
 * level). Edge: unknown albumId → `UnprocessableEntityError` (422) AND
 * `addAlbum` NOT called (validate-before-write).
 */
describe('AddAlbumToLibraryUseCase', () => {
  function setup() {
    const library = new InMemoryLibraryRepository();
    const catalog = new InMemoryCatalogRepository();
    catalog.seed({
      artists: [buildArtist({ id: 'artist-1', name: 'Artist One' })],
      albums: [
        buildAlbum({ id: 'album-1', title: 'Album One', artistId: 'artist-1' }),
        buildAlbum({ id: 'album-2', title: 'Album Two', artistId: 'artist-1' }),
      ],
    });
    return {
      useCase: new AddAlbumToLibraryUseCase(library, catalog),
      library,
      catalog,
    };
  }

  const NOW = new Date('2025-06-01T00:00:00.000Z');

  it('first save calls addAlbum with the caller id + albumId + now', async () => {
    const { useCase, library } = setup();
    const addSpy = vi.spyOn(library, 'addAlbum');

    await useCase.execute({ userId: 'user-1', albumId: 'album-1', now: NOW });

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith({ userId: 'user-1', albumId: 'album-1', now: NOW });
    const rows = await library.listByUser('user-1');
    expect(rows).toEqual([{ albumId: 'album-1', addedAt: NOW }]);
  });

  it('re-saving an already-saved album still calls the upsert and never throws (REQ-L-002)', async () => {
    const { useCase, library } = setup();
    const addSpy = vi.spyOn(library, 'addAlbum');
    const LATER = new Date('2025-06-02T00:00:00.000Z');

    await useCase.execute({ userId: 'user-1', albumId: 'album-1', now: NOW });
    await expect(
      useCase.execute({ userId: 'user-1', albumId: 'album-1', now: LATER }),
    ).resolves.toBeUndefined();

    // The upsert ran twice and reset addedAt (re-save moves to the top).
    expect(addSpy).toHaveBeenCalledTimes(2);
    const rows = await library.listByUser('user-1');
    expect(rows).toEqual([{ albumId: 'album-1', addedAt: LATER }]);
  });

  it('saving a second album keeps both rows distinct per pair', async () => {
    const { useCase, library } = setup();
    const LATER = new Date('2025-06-03T00:00:00.000Z');

    await useCase.execute({ userId: 'user-1', albumId: 'album-1', now: NOW });
    await useCase.execute({ userId: 'user-1', albumId: 'album-2', now: LATER });

    const rows = await library.listByUser('user-1');
    expect(rows.map((r) => r.albumId)).toEqual(['album-2', 'album-1']);
  });

  it('unknown albumId throws UnprocessableEntityError (422) AND addAlbum is NOT called', async () => {
    const { useCase, library } = setup();
    const addSpy = vi.spyOn(library, 'addAlbum');

    try {
      await useCase.execute({ userId: 'user-1', albumId: 'nope', now: NOW });
      throw new Error('expected UnprocessableEntityError');
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityError);
      expect((error as UnprocessableEntityError).code).toBe('UNPROCESSABLE_ENTITY');
      expect((error as UnprocessableEntityError).status).toBe(422);
      expect((error as Error).message).toBe('album not found: nope');
    }

    // Validate BEFORE any write (REQ-L-002): zero rows were written.
    expect(addSpy).not.toHaveBeenCalled();
    expect(await library.listByUser('user-1')).toEqual([]);
  });
});

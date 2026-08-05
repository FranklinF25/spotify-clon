import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '../../../shared/errors/forbidden-error';
import { NotFoundError } from '../../../shared/errors/not-found-error';
import {
  InMemoryPlaylistsRepository,
  buildPlaylist,
  buildPlaylistTrack,
} from '../../../../test/helpers/playlists-fakes';
import { DeletePlaylistUseCase } from './delete-playlist.use-case';

/**
 * Unit spec for `DeletePlaylistUseCase` (F5 — design §14.2).
 *
 * Happy: missing → NotFoundError; non-owner → ForbiddenError. The actual FK
 * CASCADE that clears `playlist_tracks` in one statement (REQ-P-006) is
 * asserted at the integration layer (WORK-PR1-08 prisma adapter spec) — this
 * unit spec only asserts the application-layer contract (ownership +
 * existence) against the in-memory fake.
 */
describe('DeletePlaylistUseCase', () => {
  function setup() {
    const playlists = new InMemoryPlaylistsRepository();
    return { useCase: new DeletePlaylistUseCase(playlists), playlists };
  }

  it('deletes the playlist when the caller is the owner', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1', title: 'Mine' })],
      tracksByPlaylist: {
        'pl-1': [buildPlaylistTrack({ playlistId: 'pl-1', position: 1 })],
      },
    });

    await useCase.execute({ id: 'pl-1', ownerId: 'user-1' });

    // Playlist gone, and the in-memory fake mirrors FK CASCADE by clearing
    // playlist_tracks on delete (REQ-P-006 invariant at the contract level).
    expect(await playlists.findById('pl-1')).toBeNull();
    expect(await playlists.findOrderedTrackIds('pl-1')).toEqual([]);
  });

  it('throws NotFoundError when the playlist is missing', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ id: 'nope', ownerId: 'user-1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when the caller is not the owner', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1', title: 'Mine' })],
    });

    await expect(
      useCase.execute({ id: 'pl-1', ownerId: 'user-2' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('NotFoundError precedence: a non-owner mutating a missing playlist gets 404 (no existence leak)', async () => {
    const { useCase } = setup();

    try {
      await useCase.execute({ id: 'does-not-exist', ownerId: 'user-2' });
      throw new Error('expected NotFoundError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).not.toBeInstanceOf(ForbiddenError);
    }
  });
});

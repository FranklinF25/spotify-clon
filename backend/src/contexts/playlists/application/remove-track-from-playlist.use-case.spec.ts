import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '../../../shared/errors/forbidden-error';
import { NotFoundError } from '../../../shared/errors/not-found-error';
import {
  InMemoryPlaylistsRepository,
  buildPlaylist,
  buildPlaylistTrack,
} from '../../../../test/helpers/playlists-fakes';
import { RemoveTrackFromPlaylistUseCase } from './remove-track-from-playlist.use-case';

/**
 * Unit spec for `RemoveTrackFromPlaylistUseCase` (F5 — design §14.2).
 *
 * Happy: owner removes a track → 204 (void). Edge: missing playlist →
 * NotFoundError; non-existent position → NotFoundError; non-owner →
 * ForbiddenError.
 *
 * The compact-on-remove post-state (positions stay dense 1..count) is
 * asserted at the integration layer (WORK-PR1-08 prisma adapter spec) —
 * this unit spec only asserts the application-layer contract (existence +
 * ownership + position pre-check) against the in-memory fake.
 */
describe('RemoveTrackFromPlaylistUseCase', () => {
  function setup() {
    const playlists = new InMemoryPlaylistsRepository();
    return { useCase: new RemoveTrackFromPlaylistUseCase(playlists), playlists };
  }

  it('removes the track at the given position when the caller is the owner', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [
          buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 't1' }),
          buildPlaylistTrack({ playlistId: 'pl-1', position: 2, trackId: 't2' }),
          buildPlaylistTrack({ playlistId: 'pl-1', position: 3, trackId: 't3' }),
        ],
      },
    });

    await useCase.execute({ id: 'pl-1', ownerId: 'user-1', position: 2 });

    // Compaction (in-memory fake mirrors the repo contract): position 3
    // shifts down to 2. Positions stay dense 1..count.
    const rows = await playlists.findOrderedTrackIds('pl-1');
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(rows.map((r) => r.trackId)).toEqual(['t1', 't3']);
  });

  it('throws NotFoundError when the playlist is missing', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ id: 'nope', ownerId: 'user-1', position: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when the position does not exist (above max)', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 't1' })],
      },
    });

    try {
      await useCase.execute({ id: 'pl-1', ownerId: 'user-1', position: 99 });
      throw new Error('expected NotFoundError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).code).toBe('NOT_FOUND');
      // The error names the position explicitly so the client can map it back.
      expect((error as Error).message).toContain('pl-1#99');
    }
  });

  it('throws NotFoundError when the position is below 1 (defensive)', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 't1' })],
      },
    });

    await expect(
      useCase.execute({ id: 'pl-1', ownerId: 'user-1', position: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when the caller is not the owner', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 't1' })],
      },
    });

    await expect(
      useCase.execute({ id: 'pl-1', ownerId: 'user-2', position: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('NotFoundError precedence: non-owner on missing playlist gets 404 (no existence leak)', async () => {
    const { useCase } = setup();

    try {
      await useCase.execute({ id: 'nope', ownerId: 'user-2', position: 1 });
      throw new Error('expected NotFoundError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).not.toBeInstanceOf(ForbiddenError);
    }
  });

  it('removing the only track leaves an empty playlist', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 't1' })],
      },
    });

    await useCase.execute({ id: 'pl-1', ownerId: 'user-1', position: 1 });

    const rows = await playlists.findOrderedTrackIds('pl-1');
    expect(rows).toEqual([]);
  });
});

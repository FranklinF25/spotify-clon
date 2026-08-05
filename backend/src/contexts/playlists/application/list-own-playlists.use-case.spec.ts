import { describe, expect, it } from 'vitest';

import {
  InMemoryPlaylistsRepository,
  buildPlaylist,
} from '../../../../test/helpers/playlists-fakes';
import { ListOwnPlaylistsUseCase } from './list-own-playlists.use-case';

/**
 * Unit spec for `ListOwnPlaylistsUseCase` (F5 — design §14.2).
 *
 * Happy: returns ONLY the caller's playlists (fake pre-populated with two
 * owners). Read-only, owner-scoped at the SQL level (REQ-P-003).
 *
 * The summary shape carries NO `userId` field — it is implicit (LOCKED
 * design §8: `PlaylistSummary[]`).
 */
describe('ListOwnPlaylistsUseCase', () => {
  function setup() {
    const playlists = new InMemoryPlaylistsRepository();
    return { useCase: new ListOwnPlaylistsUseCase(playlists), playlists };
  }

  it('returns only the caller playlists, newest first', async () => {
    const { useCase, playlists } = setup();
    const earlier = new Date('2024-12-01T00:00:00.000Z');
    const later = new Date('2025-01-15T00:00:00.000Z');
    playlists.seed({
      playlists: [
        buildPlaylist({ id: 'pl-old', userId: 'user-1', title: 'Old', createdAt: earlier }),
        buildPlaylist({ id: 'pl-new', userId: 'user-1', title: 'New', createdAt: later }),
        buildPlaylist({ id: 'pl-other', userId: 'user-2', title: 'Theirs' }),
      ],
    });

    const result = await useCase.execute({ ownerId: 'user-1' });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('pl-new'); // newest first
    expect(result[1].id).toBe('pl-old');
    // No playlist from user-2 leaks.
    expect(result.find((p) => p.id === 'pl-other')).toBeUndefined();
  });

  it('summary shape omits userId (implicit per LOCKED design §8)', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1', title: 'Mine' })],
    });

    const [summary] = await useCase.execute({ ownerId: 'user-1' });

    expect(summary).toEqual({
      id: 'pl-1',
      title: 'Mine',
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(summary).not.toHaveProperty('userId');
  });

  it('returns an empty array when the caller has no playlists', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-2' })],
    });

    const result = await useCase.execute({ ownerId: 'user-1' });

    expect(result).toEqual([]);
  });
});

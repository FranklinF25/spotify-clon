import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../../shared/errors/not-found-error';
import {
  InMemoryCatalogRepository,
  buildTrack,
} from '../../../../test/helpers/catalog-fakes';
import {
  InMemoryPlaylistsRepository,
  buildPlaylist,
  buildPlaylistTrack,
} from '../../../../test/helpers/playlists-fakes';
import { ListPlaylistTracksUseCase } from './list-playlist-tracks.use-case';
import type { PlaylistLoggerPort } from './list-playlist-tracks.use-case';

/**
 * Unit spec for `ListPlaylistTracksUseCase` (F5 — design §14.2).
 *
 * The InMemoryCatalogRepository returns rows in the order they were seeded
 * (NOT in the order of the requested ids). The use case MUST re-sort by
 * playlist position because the port contract says "order NOT guaranteed".
 * This spec seeds catalog tracks in REVERSED order to force the re-sort path.
 *
 * Silent-omit (LOCKED product #3 + design R7): unresolved track references
 * are dropped from the result AND logged at warn level with the pinned shape
 * { playlistId, omittedTrackIds[], count }.
 */
describe('ListPlaylistTracksUseCase', () => {
  function setup() {
    const playlists = new InMemoryPlaylistsRepository();
    const catalog = new InMemoryCatalogRepository();
    const logger: PlaylistLoggerPort = { warn: vi.fn() };
    const useCase = new ListPlaylistTracksUseCase(playlists, catalog, logger);
    return { useCase, playlists, catalog, logger };
  }

  it('returns tracks ordered by playlist position regardless of findTrackByIds order (R-app-3 re-sort)', async () => {
    const { useCase, playlists, catalog } = setup();
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
    // Catalog seeded in REVERSED order to prove the use case re-sorts.
    catalog.seed({
      tracks: [
        buildTrack({ id: 't3', title: 'Three' }),
        buildTrack({ id: 't2', title: 'Two' }),
        buildTrack({ id: 't1', title: 'One' }),
      ],
    });

    const result = await useCase.execute({ id: 'pl-1' });

    expect(result.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(result.map((t) => t.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('returns an empty array for an empty playlist', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
    });

    const result = await useCase.execute({ id: 'pl-1' });

    expect(result).toEqual([]);
  });

  it('omits unresolved tracks AND emits the pinned-shape warn log (silent-omit)', async () => {
    const { useCase, playlists, catalog, logger } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [
          buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 't1' }),
          buildPlaylistTrack({ playlistId: 'pl-1', position: 2, trackId: 't2-broken' }),
          buildPlaylistTrack({ playlistId: 'pl-1', position: 3, trackId: 't3' }),
        ],
      },
    });
    catalog.seed({
      tracks: [
        buildTrack({ id: 't1', title: 'One' }),
        // t2-broken intentionally NOT seeded — catalog returns [] for it.
        buildTrack({ id: 't3', title: 'Three' }),
      ],
    });

    const result = await useCase.execute({ id: 'pl-1' });

    expect(result.map((t) => t.id)).toEqual(['t1', 't3']);
    // The warn was called exactly once with the pinned shape.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, context] = logger.warn.mock.calls[0];
    expect(message).toBe('Playlist hydration omitted unresolved track references');
    expect(context).toEqual({
      playlistId: 'pl-1',
      omittedTrackIds: ['t2-broken'],
      count: 1,
    });
  });

  it('does NOT emit a warn when all tracks resolve (silent-omit is silent on the happy path)', async () => {
    const { useCase, playlists, catalog, logger } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 't1' })],
      },
    });
    catalog.seed({ tracks: [buildTrack({ id: 't1', title: 'One' })] });

    await useCase.execute({ id: 'pl-1' });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('preserves repeatable tracks (LOCKED product #2): [T1, T2, T1] at positions 1, 2, 3', async () => {
    const { useCase, playlists, catalog } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [
          buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 't1' }),
          buildPlaylistTrack({ playlistId: 'pl-1', position: 2, trackId: 't2' }),
          buildPlaylistTrack({ playlistId: 'pl-1', position: 3, trackId: 't1' }),
        ],
      },
    });
    catalog.seed({
      tracks: [
        buildTrack({ id: 't2', title: 'Two' }),
        buildTrack({ id: 't1', title: 'One' }),
      ],
    });

    const result = await useCase.execute({ id: 'pl-1' });

    // Three rows out, with t1 appearing at positions 1 AND 3 (not deduped).
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.id)).toEqual(['t1', 't2', 't1']);
  });

  it('throws NotFoundError when the playlist is missing', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('open read — does NOT require an ownerId param (REQ-P-004)', async () => {
    const { useCase, playlists, catalog } = setup();
    playlists.seed({
      // Owned by user-1; the use case must still read it for any caller.
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 't1' })],
      },
    });
    catalog.seed({ tracks: [buildTrack({ id: 't1', title: 'One' })] });

    // No ownerId in the input shape — the open-read posture is structural.
    const result = await useCase.execute({ id: 'pl-1' });

    expect(result.map((t) => t.id)).toEqual(['t1']);
  });
});

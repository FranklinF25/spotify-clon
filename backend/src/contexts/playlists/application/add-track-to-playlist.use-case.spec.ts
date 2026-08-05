import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../../../shared/errors/forbidden-error';
import { NotFoundError } from '../../../shared/errors/not-found-error';
import { UnprocessableEntityError } from '../../../shared/errors/unprocessable-entity-error';
import {
  InMemoryCatalogRepository,
  buildTrack,
} from '../../../../test/helpers/catalog-fakes';
import {
  InMemoryPlaylistsRepository,
  buildPlaylist,
  buildPlaylistTrack,
} from '../../../../test/helpers/playlists-fakes';
import { AddTrackToPlaylistUseCase } from './add-track-to-playlist.use-case';

/**
 * Unit spec for `AddTrackToPlaylistUseCase` (F5 — design §14.2).
 *
 * Happy: append at max(position)+1, returns { position, trackId, addedAt }.
 * First track → position 1; same trackId twice → positions 1 and 2
 * (LOCKED product #2 — repeatable). Edge: missing playlist → NotFoundError;
 * non-owner → ForbiddenError; unknown trackId → UnprocessableEntityError
 * (LOCKED design R1 — the InMemoryCatalogRepository returns [] for an
 * unresolvable id).
 *
 * Cross-context (R-app-3): the use case consumes `CATALOG_REPOSITORY_PORT`
 * (the symbol token resolved to `InMemoryCatalogRepository` here), NEVER the
 * concrete `PrismaCatalogRepository` — the cross-context lint rule enforces
 * this in production code.
 */
describe('AddTrackToPlaylistUseCase', () => {
  function setup() {
    const playlists = new InMemoryPlaylistsRepository();
    const catalog = new InMemoryCatalogRepository();
    catalog.seed({
      tracks: [
        buildTrack({ id: 'track-1', title: 'Track One' }),
        buildTrack({ id: 'track-2', title: 'Track Two' }),
      ],
    });
    return {
      useCase: new AddTrackToPlaylistUseCase(playlists, catalog),
      playlists,
      catalog,
    };
  }

  const NOW = new Date('2025-01-01T00:00:00.000Z');

  it('appends the first track at position 1', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
    });

    const result = await useCase.execute({
      id: 'pl-1',
      ownerId: 'user-1',
      trackId: 'track-1',
      now: NOW,
    });

    expect(result).toEqual({ position: 1, trackId: 'track-1', addedAt: NOW });
    const rows = await playlists.findOrderedTrackIds('pl-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe(1);
  });

  it('appends the second track at position 2', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 'track-1' })],
      },
    });

    const result = await useCase.execute({
      id: 'pl-1',
      ownerId: 'user-1',
      trackId: 'track-2',
      now: NOW,
    });

    expect(result.position).toBe(2);
    expect(result.trackId).toBe('track-2');
  });

  it('allows the same trackId twice (LOCKED product #2 — repeatable)', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
    });

    const first = await useCase.execute({
      id: 'pl-1',
      ownerId: 'user-1',
      trackId: 'track-1',
      now: NOW,
    });
    const second = await useCase.execute({
      id: 'pl-1',
      ownerId: 'user-1',
      trackId: 'track-1',
      now: NOW,
    });

    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
    expect(first.trackId).toBe('track-1');
    expect(second.trackId).toBe('track-1');
    const rows = await playlists.findOrderedTrackIds('pl-1');
    expect(rows).toHaveLength(2);
  });

  it('throws NotFoundError when the playlist is missing', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({
        id: 'nope',
        ownerId: 'user-1',
        trackId: 'track-1',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when the caller is not the owner', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
    });

    await expect(
      useCase.execute({
        id: 'pl-1',
        ownerId: 'user-2',
        trackId: 'track-1',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws UnprocessableEntityError (code UNPROCESSABLE_ENTITY, status 422) for an unknown trackId', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
    });

    try {
      await useCase.execute({
        id: 'pl-1',
        ownerId: 'user-1',
        trackId: 'track-does-not-exist',
        now: NOW,
      });
      throw new Error('expected UnprocessableEntityError');
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityError);
      expect((error as UnprocessableEntityError).code).toBe('UNPROCESSABLE_ENTITY');
      expect((error as UnprocessableEntityError).status).toBe(422);
      expect((error as Error).message).toBe('track not found: track-does-not-exist');
    }
  });

  it('NotFoundError precedence: a non-owner on a missing playlist gets 404 (no existence leak)', async () => {
    const { useCase } = setup();

    try {
      await useCase.execute({
        id: 'does-not-exist',
        ownerId: 'user-2',
        trackId: 'track-1',
        now: NOW,
      });
      throw new Error('expected NotFoundError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).not.toBeInstanceOf(ForbiddenError);
    }
  });

  it('does NOT consult the catalog before the ownership check passes (no leak on non-owner)', async () => {
    const { useCase, playlists, catalog } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
    });
    const findSpy = vi.spyOn(catalog, 'findTrackByIds');

    await expect(
      useCase.execute({
        id: 'pl-1',
        ownerId: 'user-2',
        trackId: 'track-1',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The catalog port was never queried — the ownership check short-
    // circuited before the cross-context call. Defends against timing-based
    // information leakage and keeps the cross-context surface minimal.
    expect(findSpy).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '../../../shared/errors/forbidden-error';
import { NotFoundError } from '../../../shared/errors/not-found-error';
import { UnprocessableEntityError } from '../../../shared/errors/unprocessable-entity-error';
import {
  InMemoryPlaylistsRepository,
  buildPlaylist,
  buildPlaylistTrack,
} from '../../../../test/helpers/playlists-fakes';
import { ReorderPlaylistUseCase } from './reorder-playlist.use-case';

/**
 * Unit spec for `ReorderPlaylistUseCase` (F5 — design §14.2 + §9.2).
 *
 * Cover the insert-and-shift matrix:
 *  - forward move [A,B,C,D] from=2 to=4 -> [A,C,D,B]
 *  - backward move from=4 to=1 -> [D,A,B,C]
 *  - no-op from=2 to=2 -> [A,B,C] unchanged
 *
 * Edge: missing -> NotFoundError; non-owner -> ForbiddenError; out-of-range
 * from/to -> UnprocessableEntityError. `from === to` short-circuits to a no-op
 * WITHOUT touching the DB (REQ-P-010 scenario "No-op reorder is idempotent").
 */
describe('ReorderPlaylistUseCase', () => {
  function setup() {
    const playlists = new InMemoryPlaylistsRepository();
    return { useCase: new ReorderPlaylistUseCase(playlists), playlists };
  }

  function seedFour(playlists: InMemoryPlaylistsRepository) {
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
      tracksByPlaylist: {
        'pl-1': [
          buildPlaylistTrack({ playlistId: 'pl-1', position: 1, trackId: 'A' }),
          buildPlaylistTrack({ playlistId: 'pl-1', position: 2, trackId: 'B' }),
          buildPlaylistTrack({ playlistId: 'pl-1', position: 3, trackId: 'C' }),
          buildPlaylistTrack({ playlistId: 'pl-1', position: 4, trackId: 'D' }),
        ],
      },
    });
  }

  it('forward move: [A,B,C,D] from=2 to=4 -> [A,C,D,B]', async () => {
    const { useCase, playlists } = setup();
    seedFour(playlists);

    const result = await useCase.execute({
      id: 'pl-1',
      ownerId: 'user-1',
      from: 2,
      to: 4,
    });

    expect(result.map((r) => r.trackId)).toEqual(['A', 'C', 'D', 'B']);
    expect(result.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  });

  it('backward move: from=4 to=1 -> [D,A,B,C]', async () => {
    const { useCase, playlists } = setup();
    seedFour(playlists);

    const result = await useCase.execute({
      id: 'pl-1',
      ownerId: 'user-1',
      from: 4,
      to: 1,
    });

    expect(result.map((r) => r.trackId)).toEqual(['D', 'A', 'B', 'C']);
    expect(result.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  });

  it('no-op: from=2 to=2 -> [A,B,C,D] unchanged (idempotent, REQ-P-010)', async () => {
    const { useCase, playlists } = setup();
    seedFour(playlists);

    const result = await useCase.execute({
      id: 'pl-1',
      ownerId: 'user-1',
      from: 2,
      to: 2,
    });

    expect(result.map((r) => r.trackId)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('throws NotFoundError when the playlist is missing', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ id: 'nope', ownerId: 'user-1', from: 1, to: 2 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when the caller is not the owner', async () => {
    const { useCase, playlists } = setup();
    seedFour(playlists);

    await expect(
      useCase.execute({ id: 'pl-1', ownerId: 'user-2', from: 1, to: 2 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws UnprocessableEntityError (422) when from is out of range (0)', async () => {
    const { useCase, playlists } = setup();
    seedFour(playlists);

    try {
      await useCase.execute({ id: 'pl-1', ownerId: 'user-1', from: 0, to: 2 });
      throw new Error('expected UnprocessableEntityError');
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityError);
      expect((error as UnprocessableEntityError).code).toBe('UNPROCESSABLE_ENTITY');
      expect((error as UnprocessableEntityError).status).toBe(422);
    }
  });

  it('throws UnprocessableEntityError (422) when to exceeds maxPosition (99)', async () => {
    const { useCase, playlists } = setup();
    seedFour(playlists);

    await expect(
      useCase.execute({ id: 'pl-1', ownerId: 'user-1', from: 1, to: 99 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
  });

  it('throws UnprocessableEntityError on an empty playlist (maxPosition is 0, any from/to > 0 fails)', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1' })],
    });

    await expect(
      useCase.execute({ id: 'pl-1', ownerId: 'user-1', from: 1, to: 1 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
  });

  it('NotFoundError precedence: non-owner on missing playlist gets 404 (no existence leak)', async () => {
    const { useCase } = setup();

    try {
      await useCase.execute({ id: 'nope', ownerId: 'user-2', from: 1, to: 2 });
      throw new Error('expected NotFoundError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).not.toBeInstanceOf(ForbiddenError);
    }
  });
});

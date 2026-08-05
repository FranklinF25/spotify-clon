import { describe, expect, it } from 'vitest';

import { NotFoundError } from '../../../shared/errors/not-found-error';
import {
  InMemoryPlaylistsRepository,
  buildPlaylist,
} from '../../../../test/helpers/playlists-fakes';
import { GetPlaylistUseCase } from './get-playlist.use-case';

/**
 * Unit spec for `GetPlaylistUseCase` (F5 — design §14.2).
 *
 * Happy: returns the primitive. Edge: missing → NotFoundError.
 *
 * Open-read posture (REQ-P-004): this use case performs NO ownership check.
 * The spec explicitly does NOT pass an ownerId — any caller can read any
 * playlist. Ownership enforcement on reads is covered at the e2e layer
 * (REQ-P-004 scenarios in WORK-PR2-03).
 */
describe('GetPlaylistUseCase', () => {
  function setup() {
    const playlists = new InMemoryPlaylistsRepository();
    return { useCase: new GetPlaylistUseCase(playlists), playlists };
  }

  it('returns the primitive for an existing playlist (open read — no ownerId param)', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [
        buildPlaylist({ id: 'pl-1', userId: 'user-1', title: 'Public Read' }),
      ],
    });

    const result = await useCase.execute({ id: 'pl-1' });

    expect(result).toEqual({
      id: 'pl-1',
      userId: 'user-1',
      title: 'Public Read',
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it('throws NotFoundError (code NOT_FOUND, status 404) when the playlist is missing', async () => {
    const { useCase } = setup();

    try {
      await useCase.execute({ id: 'nope' });
      throw new Error('expected NotFoundError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).code).toBe('NOT_FOUND');
      expect((error as NotFoundError).status).toBe(404);
    }
  });
});

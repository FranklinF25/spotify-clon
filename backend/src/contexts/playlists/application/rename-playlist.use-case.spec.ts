import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '../../../shared/errors/forbidden-error';
import { NotFoundError } from '../../../shared/errors/not-found-error';
import { ValidationError } from '../../../shared/errors/validation-error';
import {
  InMemoryPlaylistsRepository,
  buildPlaylist,
} from '../../../../test/helpers/playlists-fakes';
import { RenamePlaylistUseCase } from './rename-playlist.use-case';

/**
 * Unit spec for `RenamePlaylistUseCase` (F5 — design §14.2).
 *
 * Happy: returns updated primitive with `updatedAt > createdAt`.
 * Edge: missing → NotFoundError; non-owner → ForbiddenError; invalid title →
 * ValidationError. NotFoundError precedence over ForbiddenError is structural
 * (existence checked first via `loadOwnedPlaylist`).
 */
describe('RenamePlaylistUseCase', () => {
  function setup() {
    const playlists = new InMemoryPlaylistsRepository();
    return { useCase: new RenamePlaylistUseCase(playlists), playlists };
  }

  const CREATED_AT = new Date('2024-12-01T00:00:00.000Z');
  const NOW = new Date('2025-02-01T00:00:00.000Z');

  it('renames and returns the updated primitive with updatedAt advanced', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [
        buildPlaylist({
          id: 'pl-1',
          userId: 'user-1',
          title: 'Old',
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        }),
      ],
    });

    const result = await useCase.execute({
      id: 'pl-1',
      ownerId: 'user-1',
      newTitle: '  Renamed  ',
      now: NOW,
    });

    expect(result.title).toBe('Renamed');
    expect(result.updatedAt).toBe(NOW);
    expect(result.createdAt).toBe(CREATED_AT);
    // Persisted.
    const persisted = await playlists.findById('pl-1');
    expect(persisted?.title).toBe('Renamed');
    expect(persisted?.updatedAt).toBe(NOW);
  });

  it('throws NotFoundError when the playlist is missing (existence beats ownership)', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({
        id: 'nope',
        ownerId: 'user-1',
        newTitle: 'X',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when the caller is not the owner', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1', title: 'Mine' })],
    });

    await expect(
      useCase.execute({
        id: 'pl-1',
        ownerId: 'user-2',
        newTitle: 'Hacked',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ValidationError when the new title is invalid', async () => {
    const { useCase, playlists } = setup();
    playlists.seed({
      playlists: [buildPlaylist({ id: 'pl-1', userId: 'user-1', title: 'Old' })],
    });

    await expect(
      useCase.execute({
        id: 'pl-1',
        ownerId: 'user-1',
        newTitle: 'x'.repeat(101),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('NotFoundError precedence over ForbiddenError: missing playlist never reveals existence to a non-owner', async () => {
    const { useCase } = setup();

    // Caller is not the owner AND playlist does not exist — must surface 404,
    // NOT 403 (otherwise the non-owner learns whether the UUID exists).
    try {
      await useCase.execute({
        id: 'does-not-exist',
        ownerId: 'user-2',
        newTitle: 'X',
        now: NOW,
      });
      throw new Error('expected NotFoundError');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).not.toBeInstanceOf(ForbiddenError);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../shared/errors/validation-error';
import { InMemoryPlaylistsRepository } from '../../../../test/helpers/playlists-fakes';
import { CreatePlaylistUseCase } from './create-playlist.use-case';

/**
 * Unit spec for `CreatePlaylistUseCase` (F5 — design §14.2).
 *
 * Happy: returns a `PlaylistPrimitive` with `userId = ownerId` and
 * `createdAt === updatedAt`. Edge: 0/>100/non-string title → ValidationError.
 */
describe('CreatePlaylistUseCase', () => {
  function setup() {
    const playlists = new InMemoryPlaylistsRepository();
    const useCase = new CreatePlaylistUseCase(playlists);
    return { useCase, playlists };
  }

  const NOW = new Date('2025-01-01T00:00:00.000Z');

  it('creates a playlist and returns the primitive with userId = ownerId', async () => {
    const { useCase, playlists } = setup();

    const result = await useCase.execute({
      title: 'My Mix',
      ownerId: 'user-1',
      now: NOW,
    });

    expect(result.userId).toBe('user-1');
    expect(result.title).toBe('My Mix');
    expect(result.createdAt).toBe(NOW);
    expect(result.updatedAt).toBe(NOW);
    // The playlist was actually persisted.
    const persisted = await playlists.findById(result.id);
    expect(persisted).not.toBeNull();
    expect(persisted?.title).toBe('My Mix');
  });

  it('trims the title before persisting (entity factory invariant)', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({
      title: '  Padded  ',
      ownerId: 'user-1',
      now: NOW,
    });

    expect(result.title).toBe('Padded');
  });

  it('throws ValidationError on empty title', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ title: '   ', ownerId: 'user-1', now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError on >100-char title', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ title: 'x'.repeat(101), ownerId: 'user-1', now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns a generated id (server-generated, not caller-supplied)', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({
      title: 'Mine',
      ownerId: 'user-1',
      now: NOW,
    });

    expect(result.id).toBeTruthy();
    expect(typeof result.id).toBe('string');
  });
});

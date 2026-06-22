import { describe, expect, it } from 'vitest';

import { NotFoundError } from '../../../shared/errors/not-found-error';
import {
  InMemoryCatalogRepository,
  buildTrack,
} from '../../../../test/helpers/catalog-fakes';
import { GetTrackUseCase } from './get-track.use-case';

/**
 * Unit spec for `GetTrackUseCase` (CAT-PR2a-12).
 *
 * Underpins spec scenarios (R4):
 *   - "Track detail found" — returns the Track entity (controller calls toPrimitive)
 *   - "Track not found" — 404 NOT_FOUND
 *
 * The use case returns the `Track` ENTITY (not a projection) so the controller
 * can call `.toPrimitive()` — which drops `filePath`. The entity keeps
 * `filePath` accessible for the future playback context.
 */
describe('GetTrackUseCase', () => {
  function setup() {
    const catalog = new InMemoryCatalogRepository();
    catalog.seed({
      tracks: [
        buildTrack({ id: 'track-1', title: 'Track One', filePath: '/storage/track-1.mp3' }),
      ],
    });
    const useCase = new GetTrackUseCase(catalog);
    return { useCase };
  }

  it('returns the track entity when found', async () => {
    const { useCase } = setup();

    const track = await useCase.execute({ id: 'track-1' });

    expect(track.id).toBe('track-1');
    expect(track.title).toBe('Track One');
  });

  it('keeps filePath accessible on the returned entity (playback reads it via the port)', async () => {
    const { useCase } = setup();

    const track = await useCase.execute({ id: 'track-1' });

    expect(track.filePath).toBe('/storage/track-1.mp3');
  });

  it('the returned entity drops filePath from toPrimitive (R4 guard)', async () => {
    const { useCase } = setup();

    const track = await useCase.execute({ id: 'track-1' });

    expect(track.toPrimitive()).not.toHaveProperty('filePath');
  });

  it('throws NotFoundError (code NOT_FOUND, status 404) when the track is missing', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ id: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws a NotFoundError instance when the track is missing', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ id: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

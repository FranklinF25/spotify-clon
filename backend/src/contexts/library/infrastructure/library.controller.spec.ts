import { describe, expect, it, vi } from 'vitest';

import { UnprocessableEntityError } from '../../../shared/errors/unprocessable-entity-error';
import type { RequestWithUser } from '../../identity/infrastructure/auth.guard';
import { LibraryController } from './library.controller';

/**
 * LibraryController unit specs (F6 — WORK-PR2-02, design §8).
 *
 * supertest-free (mirrors `playlists.controller.spec.ts`): each route is
 * exercised by injecting mocked use cases (`vi.fn()`) and asserting the
 * controller:
 *  - calls the right use case with `userId = req.user!.sub` inline on EVERY
 *    handler (F5 locked pattern — NO @CurrentUser decorator);
 *  - returns the use case's projection directly (GET → bare `SavedAlbum[]`,
 *    design D5) or void (POST/DELETE → `@HttpCode(204)` — NestJS defaults
 *    POST to 201, so the decorator is load-bearing);
 *  - routes BOTH param handlers through `parseAlbumIdParam` (design D6) so a
 *    malformed UUID surfaces as `UnprocessableEntityError` (422).
 *
 * The e2e suite (WORK-PR2-03/04) covers the HTTP/JWT contract end-to-end.
 */
describe('LibraryController', () => {
  const epoch = new Date('2025-01-01T00:00:00.000Z');
  const U1 = '00000000-0000-0000-0000-000000000001';
  const ALBUM_ID = '00000000-0000-0000-0000-0000000000a1';

  function buildReq(userSub = U1): RequestWithUser {
    return { user: { sub: userSub } } as unknown as RequestWithUser;
  }

  function buildController() {
    const add = { execute: vi.fn() } as never;
    const remove = { execute: vi.fn() } as never;
    const list = { execute: vi.fn() } as never;
    return {
      controller: new LibraryController(add, remove, list),
      mocks: { add, remove, list },
    };
  }

  describe('GET /library/albums (list)', () => {
    it('calls ListLibraryUseCase with userId = req.user!.sub and returns the bare SavedAlbum[] (D5)', async () => {
      const { controller, mocks } = buildController();
      const saved = [
        {
          album: { id: ALBUM_ID, title: 'A', releaseYear: 2020, coverUrl: null, artist: { id: 'ar-1', name: 'AR' } },
          addedAt: epoch,
        },
      ];
      mocks.list.execute.mockResolvedValue(saved);

      const result = await controller.list(buildReq());

      expect(mocks.list.execute).toHaveBeenCalledWith({ userId: U1 });
      expect(result).toEqual(saved);
    });
  });

  describe('POST /library/albums/:albumId (add → 204)', () => {
    it('parses the param then calls AddAlbumToLibraryUseCase with userId inline and returns void', async () => {
      const { controller, mocks } = buildController();
      mocks.add.execute.mockResolvedValue(undefined);

      const result = await controller.add(ALBUM_ID, buildReq());

      expect(mocks.add.execute).toHaveBeenCalledWith({
        userId: U1,
        albumId: ALBUM_ID,
        now: expect.any(Date),
      });
      expect(result).toBeUndefined();
    });

    it('surfaces UnprocessableEntityError for a malformed albumId param (D6 uniform guard)', async () => {
      const { controller, mocks } = buildController();
      await expect(controller.add('not-a-uuid', buildReq())).rejects.toBeInstanceOf(
        UnprocessableEntityError,
      );
      expect(mocks.add.execute).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /library/albums/:albumId (remove → 204)', () => {
    it('parses the param then calls RemoveAlbumFromLibraryUseCase with userId inline and returns void', async () => {
      const { controller, mocks } = buildController();
      mocks.remove.execute.mockResolvedValue(undefined);

      const result = await controller.remove(ALBUM_ID, buildReq());

      expect(mocks.remove.execute).toHaveBeenCalledWith({
        userId: U1,
        albumId: ALBUM_ID,
      });
      expect(result).toBeUndefined();
    });

    it('surfaces UnprocessableEntityError for a malformed albumId param (D6 uniform guard)', async () => {
      const { controller, mocks } = buildController();
      await expect(controller.remove('nope', buildReq())).rejects.toBeInstanceOf(
        UnprocessableEntityError,
      );
      expect(mocks.remove.execute).not.toHaveBeenCalled();
    });
  });
});

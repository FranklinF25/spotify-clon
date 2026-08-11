import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../../shared/errors/not-found-error';
import type { Track } from '../../../catalog/domain/track.entity';
import { PlaylistsController } from './playlists.controller';
import * as createDto from './dto/create-playlist.dto';
import * as renameDto from './dto/rename-playlist.dto';
import * as addTrackDto from './dto/add-track.dto';
import * as reorderDto from './dto/reorder.dto';
import type { RequestWithUser } from '../../identity/infrastructure/auth.guard';

/**
 * PlaylistsController unit specs (F5 — REQ-P-001..011, WORK-PR2-02).
 *
 * supertest-free: each route is exercised by injecting mocked use cases
 * (vi.fn()) and asserting the controller:
 *  - calls the right use case with the right arguments;
 *  - passes `req.user!.sub` inline as `ownerId` on EVERY mutation (LOCKED
 *    technical #6 — NO @CurrentUser decorator);
 *  - skips `ownerId` on the two open reads (GET /:id, GET /:id/tracks);
 *  - returns the use case's projection directly (the global exception filter
 *    owns error envelopes; the controller is intentionally thin).
 *
 * The e2e suite (WORK-PR2-03..05) covers the HTTP/JWT contract end-to-end.
 */
describe('PlaylistsController', () => {
  const epoch = new Date('2025-01-01T00:00:00.000Z');
  const U1 = '00000000-0000-0000-0000-000000000001';

  function buildReq(userSub = U1): RequestWithUser {
    return { user: { sub: userSub } } as unknown as RequestWithUser;
  }

  function buildController() {
    const createPlaylist = { execute: vi.fn() } as never;
    const listOwn = { execute: vi.fn() } as never;
    const getPlaylist = { execute: vi.fn() } as never;
    const renamePlaylist = { execute: vi.fn() } as never;
    const deletePlaylist = { execute: vi.fn() } as never;
    const addTrack = { execute: vi.fn() } as never;
    const listTracks = { execute: vi.fn() } as never;
    const removeTrack = { execute: vi.fn() } as never;
    const reorder = { execute: vi.fn() } as never;
    return {
      controller: new PlaylistsController(
        createPlaylist,
        listOwn,
        getPlaylist,
        renamePlaylist,
        deletePlaylist,
        addTrack,
        listTracks,
        removeTrack,
        reorder,
      ),
      mocks: {
        createPlaylist,
        listOwn,
        getPlaylist,
        renamePlaylist,
        deletePlaylist,
        addTrack,
        listTracks,
        removeTrack,
        reorder,
      },
    };
  }

  describe('POST /playlists (create)', () => {
    it('validates the body then calls CreatePlaylistUseCase with ownerId = req.user!.sub', async () => {
      const { controller, mocks } = buildController();
      const spy = vi
        .spyOn(createDto, 'parseCreatePlaylistBody')
        .mockReturnValue({ title: 'My Mix' });
      mocks.createPlaylist.execute.mockResolvedValue({
        id: 'p1',
        userId: U1,
        title: 'My Mix',
        createdAt: epoch,
        updatedAt: epoch,
      });

      const result = await controller.create({ title: 'My Mix' }, buildReq());

      expect(spy).toHaveBeenCalledWith({ title: 'My Mix' });
      // LOCKED technical #6: ownerId sourced inline from req.user!.sub.
      expect(mocks.createPlaylist.execute).toHaveBeenCalledWith({
        title: 'My Mix',
        ownerId: U1,
        now: expect.any(Date),
      });
      expect(result).toEqual({
        id: 'p1',
        userId: U1,
        title: 'My Mix',
        createdAt: epoch,
        updatedAt: epoch,
      });
      spy.mockRestore();
    });
  });

  describe('GET /playlists (list own)', () => {
    it('calls ListOwnPlaylistsUseCase with ownerId = req.user!.sub', async () => {
      const { controller, mocks } = buildController();
      mocks.listOwn.execute.mockResolvedValue([
        { id: 'p1', title: 'A', createdAt: epoch, updatedAt: epoch },
      ]);

      const result = await controller.list(buildReq());

      expect(mocks.listOwn.execute).toHaveBeenCalledWith({ ownerId: U1 });
      expect(result).toEqual([
        { id: 'p1', title: 'A', createdAt: epoch, updatedAt: epoch },
      ]);
    });
  });

  describe('GET /playlists/:id (open read)', () => {
    it('calls GetPlaylistUseCase WITHOUT ownerId (open read — REQ-P-004)', async () => {
      const { controller, mocks } = buildController();
      mocks.getPlaylist.execute.mockResolvedValue({
        id: 'p1',
        userId: 'someone-else',
        title: 'X',
        createdAt: epoch,
        updatedAt: epoch,
      });

      const result = await controller.detail('p1');

      // No ownerId — open read posture is structural (the use case signature
      // carries no ownerId parameter).
      expect(mocks.getPlaylist.execute).toHaveBeenCalledWith({ id: 'p1' });
      expect(result.id).toBe('p1');
    });
  });

  describe('PATCH /playlists/:id (rename, owner-only)', () => {
    it('validates the body then calls RenamePlaylistUseCase with ownerId inline', async () => {
      const { controller, mocks } = buildController();
      const spy = vi
        .spyOn(renameDto, 'parseRenamePlaylistBody')
        .mockReturnValue({ title: 'New' });
      mocks.renamePlaylist.execute.mockResolvedValue({
        id: 'p1',
        userId: U1,
        title: 'New',
        createdAt: epoch,
        updatedAt: epoch,
      });

      const result = await controller.rename('p1', { title: 'New' }, buildReq());

      expect(spy).toHaveBeenCalledWith({ title: 'New' });
      expect(mocks.renamePlaylist.execute).toHaveBeenCalledWith({
        id: 'p1',
        ownerId: U1,
        newTitle: 'New',
        now: expect.any(Date),
      });
      expect(result.title).toBe('New');
      spy.mockRestore();
    });
  });

  describe('DELETE /playlists/:id (owner-only)', () => {
    it('calls DeletePlaylistUseCase with ownerId inline (returns void → 204)', async () => {
      const { controller, mocks } = buildController();
      mocks.deletePlaylist.execute.mockResolvedValue(undefined);

      const result = await controller.delete('p1', buildReq());

      expect(mocks.deletePlaylist.execute).toHaveBeenCalledWith({
        id: 'p1',
        ownerId: U1,
      });
      expect(result).toBeUndefined();
    });
  });

  describe('POST /playlists/:id/tracks (add track, owner-only)', () => {
    it('validates the body then calls AddTrackToPlaylistUseCase with ownerId inline', async () => {
      const { controller, mocks } = buildController();
      const spy = vi
        .spyOn(addTrackDto, 'parseAddTrackBody')
        .mockReturnValue({ trackId: 't1' });
      mocks.addTrack.execute.mockResolvedValue({
        position: 2,
        trackId: 't1',
        addedAt: epoch,
      });

      const result = await controller.addTrack('p1', { trackId: 't1' }, buildReq());

      expect(spy).toHaveBeenCalledWith({ trackId: 't1' });
      expect(mocks.addTrack.execute).toHaveBeenCalledWith({
        id: 'p1',
        ownerId: U1,
        trackId: 't1',
        now: expect.any(Date),
      });
      expect(result).toEqual({ position: 2, trackId: 't1', addedAt: epoch });
      spy.mockRestore();
    });
  });

  describe('GET /playlists/:id/tracks (open read hydration)', () => {
    it('calls ListPlaylistTracksUseCase WITHOUT ownerId (open read — REQ-P-008)', async () => {
      const { controller, mocks } = buildController();
      mocks.listTracks.execute.mockResolvedValue([
        { id: 't1', title: 'T1', durationSeconds: 1, trackNumber: 1, albumId: 'a1' },
      ] as unknown as Track[]);

      const result = await controller.tracks('p1');

      expect(mocks.listTracks.execute).toHaveBeenCalledWith({ id: 'p1' });
      expect(result).toHaveLength(1);
    });
  });

  describe('DELETE /playlists/:id/tracks/:position (owner-only)', () => {
    it('parses position to a number and calls RemoveTrackFromPlaylistUseCase with ownerId inline', async () => {
      const { controller, mocks } = buildController();
      mocks.removeTrack.execute.mockResolvedValue(undefined);

      const result = await controller.removeTrack('p1', '2', buildReq());

      expect(mocks.removeTrack.execute).toHaveBeenCalledWith({
        id: 'p1',
        ownerId: U1,
        position: 2,
      });
      expect(result).toBeUndefined();
    });

    it('throws NotFoundError when the path param is not a positive integer', async () => {
      const { controller } = buildController();
      await expect(
        controller.removeTrack('p1', 'abc', buildReq()),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('POST /playlists/:id/reorder (owner-only)', () => {
    it('validates the body then calls ReorderPlaylistUseCase with ownerId inline', async () => {
      const { controller, mocks } = buildController();
      const spy = vi
        .spyOn(reorderDto, 'parseReorderBody')
        .mockReturnValue({ from: 2, to: 4 });
      mocks.reorder.execute.mockResolvedValue([
        { position: 1, trackId: 'a', addedAt: epoch },
        { position: 2, trackId: 'b', addedAt: epoch },
      ]);

      const result = await controller.reorder('p1', { from: 2, to: 4 }, buildReq());

      expect(spy).toHaveBeenCalledWith({ from: 2, to: 4 });
      expect(mocks.reorder.execute).toHaveBeenCalledWith({
        id: 'p1',
        ownerId: U1,
        from: 2,
        to: 4,
      });
      expect(result).toHaveLength(2);
      spy.mockRestore();
    });
  });
});

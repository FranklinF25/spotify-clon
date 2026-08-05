import { describe, expect, it } from 'vitest';

import { PlaylistTrack } from './playlist-track.vo';

/**
 * Unit spec for the `PlaylistTrack` value object (F5 — design §3.2 + §14.1).
 *
 * Reconstruct-only (NO validating factory): rows always come from persistence
 * via repository methods that compute `position` deterministically, so
 * re-checking would be wasteful. Repeatable tracks (LOCKED product #2) fall
 * out: two rows with the same `trackId` at different `position`s are distinct
 * under the composite PK.
 */
describe('PlaylistTrack', () => {
  const ADDED_AT = new Date('2025-01-01T00:00:00.000Z');

  describe('reconstruct', () => {
    it('round-trips a row WITHOUT re-validating position (DB is trusted)', () => {
      const track = PlaylistTrack.reconstruct({
        playlistId: 'pl-1',
        position: 3,
        trackId: 'track-9',
        addedAt: ADDED_AT,
      });

      expect(track.playlistId).toBe('pl-1');
      expect(track.position).toBe(3);
      expect(track.trackId).toBe('track-9');
      expect(track.addedAt).toBe(ADDED_AT);
    });

    it('accepts any integer position (including values a factory might reject)', () => {
      // Position is computed by the repository (max+1), not validated here.
      // A reconstruct from a legacy row at position 9999 is trusted.
      const track = PlaylistTrack.reconstruct({
        playlistId: 'pl-1',
        position: 9999,
        trackId: 'track-1',
        addedAt: ADDED_AT,
      });

      expect(track.position).toBe(9999);
    });
  });

  describe('toPrimitive', () => {
    it('returns { position, trackId, addedAt } — omits playlistId (mirrors Album dropping createdAt)', () => {
      const track = PlaylistTrack.reconstruct({
        playlistId: 'pl-1',
        position: 2,
        trackId: 'track-7',
        addedAt: ADDED_AT,
      });

      expect(track.toPrimitive()).toEqual({
        position: 2,
        trackId: 'track-7',
        addedAt: ADDED_AT,
      });
    });
  });

  describe('repeatable tracks (LOCKED product #2)', () => {
    it('two rows with the same trackId at different positions are distinct value objects', () => {
      // The composite PK (playlist_id, position) is what makes them distinct
      // at the DB level; the value object mirrors that by identity.
      const atPosition1 = PlaylistTrack.reconstruct({
        playlistId: 'pl-1',
        position: 1,
        trackId: 'track-repeated',
        addedAt: ADDED_AT,
      });
      const atPosition3 = PlaylistTrack.reconstruct({
        playlistId: 'pl-1',
        position: 3,
        trackId: 'track-repeated',
        addedAt: ADDED_AT,
      });

      expect(atPosition1.trackId).toBe(atPosition3.trackId);
      expect(atPosition1.position).not.toBe(atPosition3.position);
    });
  });
});

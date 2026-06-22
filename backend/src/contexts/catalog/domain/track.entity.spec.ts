import { describe, expect, it } from 'vitest';

import { Track } from './track.entity';

/**
 * Unit spec for the `Track` domain entity (CAT-PR2a-04).
 *
 * Underpins spec scenario "Reconstruct hydrates from a valid row" (R7) and
 * the filePath-leak guard (R4 + S4): `filePath` is an internal storage
 * detail that MUST stay accessible on the entity (the future `playback`
 * context reads it via the port) but MUST NOT appear in `toPrimitive()`
 * (the HTTP-facing projection). `SearchResult.tracks` uses `TrackSummary`
 * for the same reason.
 */
describe('Track entity', () => {
  const row = {
    id: 'track-1',
    title: 'Track One',
    durationSeconds: 213,
    filePath: '/storage/track-1.mp3',
    trackNumber: 1,
    albumId: 'album-1',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  describe('reconstruct', () => {
    it('hydrates every field from a persistence row (all 7 fields)', () => {
      const track = Track.reconstruct(row);

      expect(track.id).toBe('track-1');
      expect(track.title).toBe('Track One');
      expect(track.durationSeconds).toBe(213);
      expect(track.filePath).toBe('/storage/track-1.mp3');
      expect(track.trackNumber).toBe(1);
      expect(track.albumId).toBe('album-1');
      expect(track.createdAt).toBe(row.createdAt);
    });
  });

  describe('toPrimitive', () => {
    it('returns exactly the 5 HTTP-safe keys', () => {
      const primitive = Track.reconstruct(row).toPrimitive();

      expect(Object.keys(primitive).sort()).toEqual(
        ['albumId', 'durationSeconds', 'id', 'title', 'trackNumber'].sort(),
      );
    });

    it('projects the expected values', () => {
      expect(Track.reconstruct(row).toPrimitive()).toEqual({
        id: 'track-1',
        title: 'Track One',
        durationSeconds: 213,
        trackNumber: 1,
        albumId: 'album-1',
      });
    });

    it('does NOT leak filePath (internal storage detail — R4 guard)', () => {
      const primitive = Track.reconstruct(row).toPrimitive();
      expect(primitive).not.toHaveProperty('filePath');
    });

    it('does NOT leak createdAt (internal timestamp)', () => {
      const primitive = Track.reconstruct(row).toPrimitive();
      expect(primitive).not.toHaveProperty('createdAt');
    });
  });

  it('exposes filePath as a public readonly field (playback reads it via the port)', () => {
    const track = Track.reconstruct(row);
    // The future `playback` context resolves `filePath` through the
    // CatalogRepositoryPort — it must stay accessible on the entity.
    expect(track.filePath).toBe('/storage/track-1.mp3');
  });

  it('forbids direct construction — reconstruct is the only public path', () => {
    // @ts-expect-error: Constructor is private — use Track.reconstruct().
    const leak = new Track('a', 't', 1, '/p', 1, 'aid', new Date());
    expect(leak).toBeTypeOf('object');
  });
});

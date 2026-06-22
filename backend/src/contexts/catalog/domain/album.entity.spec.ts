import { describe, expect, it } from 'vitest';

import { Album } from './album.entity';

/**
 * Unit spec for the `Album` domain entity (CAT-PR2a-03).
 *
 * Underpins spec scenario "Reconstruct hydrates from a valid row" (R7).
 *
 * NOTE (R3-W3 lesson from JD Round 4): the entity carries ONLY `artistId` —
 * NOT an embedded `artist` field. The artist summary is a read-model concern
 * built by the adapter, not domain state. Embedding `artist` on the entity
 * would couple domain persistence shape to a read projection.
 */
describe('Album entity', () => {
  const row = {
    id: 'album-1',
    title: 'Album One',
    releaseYear: 2024,
    coverUrl: 'https://example.com/cover.png',
    artistId: 'artist-1',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  describe('reconstruct', () => {
    it('hydrates every field from a persistence row', () => {
      const album = Album.reconstruct(row);

      expect(album.id).toBe('album-1');
      expect(album.title).toBe('Album One');
      expect(album.releaseYear).toBe(2024);
      expect(album.coverUrl).toBe('https://example.com/cover.png');
      expect(album.artistId).toBe('artist-1');
      expect(album.createdAt).toBe(row.createdAt);
    });

    it('accepts nullable releaseYear and coverUrl', () => {
      const album = Album.reconstruct({ ...row, releaseYear: null, coverUrl: null });

      expect(album.releaseYear).toBeNull();
      expect(album.coverUrl).toBeNull();
    });
  });

  describe('toPrimitive', () => {
    it('returns the { id, title, releaseYear, coverUrl, artistId } projection', () => {
      const album = Album.reconstruct(row);

      expect(album.toPrimitive()).toEqual({
        id: 'album-1',
        title: 'Album One',
        releaseYear: 2024,
        coverUrl: 'https://example.com/cover.png',
        artistId: 'artist-1',
      });
    });

    it('does NOT leak createdAt (internal timestamp)', () => {
      const primitive = Album.reconstruct(row).toPrimitive();
      expect(primitive).not.toHaveProperty('createdAt');
    });

    it('does NOT embed artist — artistId is the only artist reference on the entity', () => {
      const primitive = Album.reconstruct(row).toPrimitive();
      expect(primitive).not.toHaveProperty('artist');
      expect(primitive).toHaveProperty('artistId', 'artist-1');
    });
  });

  it('forbids direct construction — reconstruct is the only public path', () => {
    // Compile-time guard: `@ts-expect-error` proves the constructor is
    // private. If it ever becomes public, the directive stops suppressing an
    // error and `tsc --noEmit` fails.
    // @ts-expect-error: Constructor is private — use Album.reconstruct().
    const leak = new Album('a', 't', 2024, null, 'aid', new Date());
    expect(leak).toBeTypeOf('object');
  });
});

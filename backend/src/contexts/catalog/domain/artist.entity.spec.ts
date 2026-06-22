import { describe, expect, it } from 'vitest';

import { Artist } from './artist.entity';

/**
 * Unit spec for the `Artist` domain entity (CAT-PR2a-02).
 *
 * Underpins spec scenario "Reconstruct hydrates from a valid row" (R7):
 * the entity exposes a static `reconstruct()` that hydrates every field
 * straight from a persistence row with NO write-side invariants — the DB
 * is the trusted source of truth.
 *
 * Also pins the two public projections:
 *  - `toPrimitive()` — full HTTP-facing artist projection (id/name/bio/imageUrl).
 *  - `toSummary()` — the lean `{ id, name }` shape used by list endpoints and
 *    embedded inside `AlbumSummary.artist`.
 *
 * The private constructor guarantees reconstruction is the ONLY construction
 * path (validated at the type level via `@ts-expect-error`).
 */
describe('Artist entity', () => {
  const row = {
    id: 'artist-1',
    name: 'Artist One',
    bio: 'A short bio',
    imageUrl: 'https://example.com/a.png',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  describe('reconstruct', () => {
    it('hydrates every field from a persistence row', () => {
      const artist = Artist.reconstruct(row);

      expect(artist.id).toBe('artist-1');
      expect(artist.name).toBe('Artist One');
      expect(artist.bio).toBe('A short bio');
      expect(artist.imageUrl).toBe('https://example.com/a.png');
      expect(artist.createdAt).toBe(row.createdAt);
    });

    it('accepts nullable bio and imageUrl', () => {
      const artist = Artist.reconstruct({ ...row, bio: null, imageUrl: null });

      expect(artist.bio).toBeNull();
      expect(artist.imageUrl).toBeNull();
    });
  });

  describe('toPrimitive', () => {
    it('returns the { id, name, bio, imageUrl } projection', () => {
      const artist = Artist.reconstruct(row);

      expect(artist.toPrimitive()).toEqual({
        id: 'artist-1',
        name: 'Artist One',
        bio: 'A short bio',
        imageUrl: 'https://example.com/a.png',
      });
    });

    it('does NOT leak createdAt (internal timestamp)', () => {
      const artist = Artist.reconstruct(row);
      const primitive = artist.toPrimitive();

      expect(primitive).not.toHaveProperty('createdAt');
    });
  });

  describe('toSummary', () => {
    it('returns the lean { id, name } summary', () => {
      const artist = Artist.reconstruct(row);

      expect(artist.toSummary()).toEqual({ id: 'artist-1', name: 'Artist One' });
    });
  });

  it('forbids direct construction — reconstruct is the only public path', () => {
    // Type-level guard: the constructor is private. If it ever becomes public,
    // the @ts-expect-error directive below stops suppressing an error and
    // `tsc --noEmit` (the architecture/CI gate) fails. This is a compile-time
    // guarantee, not a runtime one — JS does not enforce `private` at runtime.
    // @ts-expect-error: Constructor is private — use Artist.reconstruct().
    const leak = new Artist('a', 'b', null, null, new Date());
    // Reference `leak` so esbuild does not elide the line above.
    expect(leak).toBeTypeOf('object');
  });
});

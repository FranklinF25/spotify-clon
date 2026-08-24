import { describe, expect, it } from 'vitest';
import {
  savedAlbumAssertionSchema,
  savedAlbumListAssertionSchema,
} from './library';

/**
 * F6 WORK-PR3-01 — zod mirror for the library list contract (REQ-FE-016;
 * mirrors test/contract/schemas.ts discipline). `addedAt` is an ISO string
 * from JSON; a drift entry missing it MUST be rejected (REQ-FE-005
 * discipline referenced by REQ-FE-016).
 */
const ALBUM_A1 = {
  id: 'A1',
  title: 'Kind of Blue',
  releaseYear: 1959,
  coverUrl: null,
  artist: { id: 'ar1', name: 'Miles Davis' },
};

describe('savedAlbumAssertionSchema', () => {
  it('parses a valid saved-album entry', () => {
    const result = savedAlbumAssertionSchema.safeParse({
      album: ALBUM_A1,
      addedAt: '2025-01-02T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a drift entry missing addedAt', () => {
    const result = savedAlbumAssertionSchema.safeParse({ album: ALBUM_A1 });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO addedAt', () => {
    const result = savedAlbumAssertionSchema.safeParse({
      album: ALBUM_A1,
      addedAt: 'yesterday',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a drift album missing the embedded artist', () => {
    const result = savedAlbumAssertionSchema.safeParse({
      album: { id: 'A1', title: 'X', releaseYear: null, coverUrl: null },
      addedAt: '2025-01-02T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('savedAlbumListAssertionSchema', () => {
  it('parses a non-empty list preserving recency order', () => {
    const result = savedAlbumListAssertionSchema.safeParse([
      { album: ALBUM_A1, addedAt: '2025-01-02T00:00:00.000Z' },
      {
        album: { ...ALBUM_A1, id: 'A2', title: 'Another' },
        addedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map((s) => s.album.id)).toEqual(['A1', 'A2']);
    }
  });

  it('parses an honest empty list', () => {
    const result = savedAlbumListAssertionSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('rejects a list with one drifted entry among valid ones', () => {
    const result = savedAlbumListAssertionSchema.safeParse([
      { album: ALBUM_A1, addedAt: '2025-01-02T00:00:00.000Z' },
      { album: ALBUM_A1 }, // missing addedAt — drift
    ]);
    expect(result.success).toBe(false);
  });
});

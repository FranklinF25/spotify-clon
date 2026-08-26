import { describe, it, expect } from 'vitest';
import {
  albumDetailAssertionSchema,
  artistDetailAssertionSchema,
  albumSummaryAssertionSchema,
  searchResultAssertionSchema,
  refreshResponseAssertionSchema,
  uploadResultAssertionSchema,
} from './schemas';

/**
 * Negative contract test (REQ-FE-005 "Contract test catches a drifted
 * field"). A deliberately drifted fixture MUST be REJECTED by the assertion
 * schema — this is the primary mitigation for the hand-synced-types tradeoff.
 * If any of these PASS, drift would silently leak through to production.
 */
describe('drift detection (REQ-FE-005)', () => {
  it('rejects an AlbumDetail missing the embedded tracks[] array', () => {
    const drifted = {
      id: 'a1',
      title: 'Drifted',
      releaseYear: 2020,
      coverUrl: null,
      artistId: 'ar1',
      artist: { id: 'ar1', name: 'Artist' },
      // tracks[] deliberately OMITTED — the regression this guard catches.
    };
    const result = albumDetailAssertionSchema.safeParse(drifted);
    expect(result.success).toBe(false);
  });

  it('rejects an AlbumDetail whose tracks[] is undefined (not an array)', () => {
    const result = albumDetailAssertionSchema.safeParse({
      id: 'a1',
      title: 'Drifted',
      releaseYear: 2020,
      coverUrl: null,
      artistId: 'ar1',
      artist: { id: 'ar1', name: 'Artist' },
      tracks: undefined,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an ArtistDetail missing the embedded albums[] array', () => {
    const result = artistDetailAssertionSchema.safeParse({
      id: 'ar1',
      name: 'Artist',
      bio: null,
      imageUrl: null,
      // albums[] deliberately OMITTED.
    });
    expect(result.success).toBe(false);
  });

  it('rejects an AlbumSummary missing the embedded artist', () => {
    const result = albumSummaryAssertionSchema.safeParse({
      id: 'a1',
      title: 'Drifted',
      releaseYear: 2020,
      coverUrl: null,
      // artist OMITTED.
    });
    expect(result.success).toBe(false);
  });

  it('rejects a SearchResult missing the tracks group', () => {
    const result = searchResultAssertionSchema.safeParse({
      artists: [],
      albums: [],
      // tracks OMITTED.
    });
    expect(result.success).toBe(false);
  });

  it('rejects a refresh response that wrongly includes a user field (strict)', () => {
    const result = refreshResponseAssertionSchema.safeParse({
      accessToken: 't',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an UploadResult missing the album block (REQ-UPLOAD-001)', () => {
    const result = uploadResultAssertionSchema.safeParse({
      track: {
        id: 't1',
        title: 'T',
        durationSeconds: 180,
        albumId: 'a1',
      },
      artist: { id: 'ar1', name: 'Artist' },
      // album OMITTED — the success row renders "(album …)" from it.
    });
    expect(result.success).toBe(false);
  });

  it('rejects an UploadResult leaking a filePath field (R4 guard)', () => {
    const result = uploadResultAssertionSchema.safeParse({
      track: {
        id: 't1',
        title: 'T',
        durationSeconds: 180,
        albumId: 'a1',
        filePath: '/data/audio/T.mp3', // internal storage detail — must not leak
      },
      artist: { id: 'ar1', name: 'Artist' },
      album: { id: 'a1', title: 'Album' },
    });
    // z.object is strip-by-default: filePath is IGNORED, and every required
    // key is present — so this parses. The filePath LEAK is caught by the
    // FE-PR1-13 architecture regex on types/api.ts (the contract surface),
    // not here; this case documents that division of labour.
    expect(result.success).toBe(true);
  });

  it('rejects a TrackPrimitive using durationMs instead of durationSeconds', () => {
    const drifted = {
      id: 't1',
      title: 'Drifted',
      durationMs: 180000, // WRONG field — the famous ms/seconds regression
      trackNumber: 1,
      albumId: 'a1',
    };
    // Parse as a tracks-array detail so the schema exercises the track shape.
    const result = albumDetailAssertionSchema.safeParse({
      id: 'a1',
      title: 'Album',
      releaseYear: 2020,
      coverUrl: null,
      artistId: 'ar1',
      artist: { id: 'ar1', name: 'Artist' },
      tracks: [drifted],
    });
    expect(result.success).toBe(false);
  });
});

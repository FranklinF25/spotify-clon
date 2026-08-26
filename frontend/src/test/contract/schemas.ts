import { z } from 'zod';

/**
 * Runtime contract parsers (REQ-FE-005 drift mitigation, DESIGN §10).
 *
 * These are TEST-ONLY assertion schemas that mirror the projection types in
 * `src/types/api.ts` (DESIGN §4.1). They are DISTINCT from the form-validators
 * in `src/lib/zod-schemas/` (register/login/pagination/search) — those
 * validate user input; these validate backend response SHAPES so a drifted
 * field fails CI instead of silently leaking to production.
 *
 * Required-key semantics matter: e.g. `tracks: z.array(...)` (NOT optional)
 * is what makes a drifted AlbumDetail (tracks omitted) REJECT — see drift.spec.
 */
export const userAssertionSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
});

export const artistSummaryAssertionSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const trackPrimitiveAssertionSchema = z.object({
  id: z.string(),
  title: z.string(),
  // durationSeconds (NOT durationMs) — the famous regression this catches.
  durationSeconds: z.number(),
  trackNumber: z.number(),
  albumId: z.string(),
});

export const trackSummaryAssertionSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationSeconds: z.number(),
  // albumId INTENTIONALLY present (read-models asymmetry — DESIGN §4.1).
  albumId: z.string(),
});

export const albumSummaryAssertionSchema = z.object({
  id: z.string(),
  title: z.string(),
  releaseYear: z.number().nullable(),
  coverUrl: z.string().nullable(),
  artist: artistSummaryAssertionSchema,
});

export const albumDetailAssertionSchema = z.object({
  id: z.string(),
  title: z.string(),
  releaseYear: z.number().nullable(),
  coverUrl: z.string().nullable(),
  artistId: z.string(),
  artist: artistSummaryAssertionSchema,
  // REQUIRED array (can be empty, but the key MUST exist) — drift test omits
  // this and must fail.
  tracks: z.array(trackPrimitiveAssertionSchema),
});

export const artistDetailAssertionSchema = z.object({
  id: z.string(),
  name: z.string(),
  bio: z.string().nullable(),
  imageUrl: z.string().nullable(),
  albums: z.array(albumSummaryAssertionSchema),
});

export const searchResultAssertionSchema = z.object({
  artists: z.array(artistSummaryAssertionSchema),
  albums: z.array(albumSummaryAssertionSchema),
  tracks: z.array(trackSummaryAssertionSchema),
});

export const authResponseAssertionSchema = z.object({
  accessToken: z.string(),
  user: userAssertionSchema,
});

// STRICT — rejects an unexpected `user` field. AuthController.refresh returns
// { accessToken } ONLY; the boot flow hydrates user via GET /me.
export const refreshResponseAssertionSchema = z
  .object({
    accessToken: z.string(),
  })
  .strict();

// Mirrors UploadTrackResult (POST /tracks/upload 201 body). REQUIRED keys so
// a drifted backend projection (album omitted, or the internal storage path
// leaking as `filePath`) REJECTS instead of rendering partial truth.
export const uploadResultAssertionSchema = z.object({
  track: z.object({
    id: z.string(),
    title: z.string(),
    durationSeconds: z.number(),
    albumId: z.string(),
  }),
  artist: z.object({
    id: z.string(),
    name: z.string(),
  }),
  album: z.object({
    id: z.string(),
    title: z.string(),
  }),
});

/** Generic offset-pagination envelope, parameterised by the item shape. */
export function paginatedAssertionSchema<T extends z.ZodTypeAny>(
  itemSchema: T,
) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  });
}

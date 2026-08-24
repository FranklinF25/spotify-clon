import { z } from 'zod';

/**
 * Library list parser (F6, REQ-FE-016; DESIGN §9.6). Assertion-schema
 * discipline mirroring `test/contract/schemas.ts`: validates the
 * `SavedAlbum` wire shape so a drifted backend projection fails CI
 * instead of silently leaking to production. `addedAt` is an ISO string
 * from JSON.
 */
const albumSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  releaseYear: z.number().nullable(),
  coverUrl: z.string().nullable(),
  artist: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export const savedAlbumAssertionSchema = z.object({
  album: albumSummarySchema,
  // zod v3 ISO-8601 validator (the v4 `.iso()` spelling does not exist here).
  addedAt: z.string().datetime(),
});

export const savedAlbumListAssertionSchema = z.array(
  savedAlbumAssertionSchema,
);

import { z } from 'zod';

/**
 * Search query schema for `GET /search` (CAT-PR2b1-02).
 *
 * `q` is required, trimmed, and must be non-empty after trim. Empty-`q`
 * surfaces as `INVALID_QUERY` via the `validateSearch` wrapper
 * (CAT-PR2b1-03) — spec scenario R6 "Empty query is rejected".
 *
 * `type` filters to a single group; when omitted all three groups
 * (artists / albums / tracks) are populated by the adapter.
 */
export const searchSchema = z.object({
  q: z.string().trim().min(1, 'query is required'),
  type: z.enum(['artist', 'album', 'track']).optional(),
});

export type SearchDto = z.infer<typeof searchSchema>;

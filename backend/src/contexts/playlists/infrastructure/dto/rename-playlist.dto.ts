import { z } from 'zod';

import { validate } from '../../../identity/infrastructure/dto/validate';

/**
 * Rename-playlist request body (F5 — REQ-P-005, design §11).
 *
 * Identical shape to {@link createPlaylistSchema} — the LOCKED product decision
 * #5 applies the same 1..100 title invariant to rename as to create. The
 * spec-pinned error code is `VALIDATION_ERROR` (400); no error-class swap.
 */
export const renamePlaylistSchema = z.object({
  title: z.string().min(1).max(100),
});

export type RenamePlaylistDto = z.infer<typeof renamePlaylistSchema>;

/**
 * Parse the rename-playlist body via identity's `validate()` wrapper so Zod
 * failures surface as `ValidationError` with field-scoped `details`.
 */
export function parseRenamePlaylistBody(input: unknown): RenamePlaylistDto {
  return validate(renamePlaylistSchema, input);
}

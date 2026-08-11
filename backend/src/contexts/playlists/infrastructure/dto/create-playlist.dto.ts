import { z } from 'zod';

import { validate } from '../../../identity/infrastructure/dto/validate';

/**
 * Create-playlist request body (F5 — REQ-P-002, design §11).
 *
 * Enforces the LOCKED product decision #5 (title 1..100 chars) at the HTTP
 * edge via zod. The entity factory re-validates after trimming; the DTO
 * catches the malformed-payload cases (empty / over-length / wrong type /
 * missing) so the global exception filter emits the canonical
 * `VALIDATION_ERROR` 400 envelope with field-scoped `details`.
 *
 * NO column CHECK (LOCKED design R5) — validation lives in DTO + entity only.
 */
export const createPlaylistSchema = z.object({
  title: z.string().min(1).max(100),
});

export type CreatePlaylistDto = z.infer<typeof createPlaylistSchema>;

/**
 * Parse the create-playlist body via identity's `validate()` wrapper so Zod
 * failures surface as `ValidationError` with field-scoped `details`
 * (`[{ field: 'title', issue: <zod-code> }]`). Spec-pinned error code is
 * `VALIDATION_ERROR` (400) — no error-class swap needed.
 */
export function parseCreatePlaylistBody(input: unknown): CreatePlaylistDto {
  return validate(createPlaylistSchema, input);
}

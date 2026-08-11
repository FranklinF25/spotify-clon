import { z } from 'zod';

import { validate } from '../../../identity/infrastructure/dto/validate';

/**
 * Add-track request body (F5 — REQ-P-007, design §11).
 *
 * Enforces a well-formed UUID `trackId` at the HTTP edge. A
 * well-formed-but-unresolvable UUID (one that does not match any catalog row)
 * is the 422 case — that is the use case's job
 * (`AddTrackToPlaylistUseCase` throws `UnprocessableEntityError` after
 * `findTrackByIds` returns 0). The DTO only catches the malformed-payload
 * cases (missing / wrong type / non-UUID) → 400 `VALIDATION_ERROR`.
 */
export const addTrackSchema = z.object({
  trackId: z.string().uuid(),
});

export type AddTrackDto = z.infer<typeof addTrackSchema>;

/**
 * Parse the add-track body via identity's `validate()` wrapper so Zod
 * failures surface as `ValidationError` with field-scoped `details`
 * (`[{ field: 'trackId', issue: 'invalid_uuid' }]`).
 */
export function parseAddTrackBody(input: unknown): AddTrackDto {
  return validate(addTrackSchema, input);
}

import { z } from 'zod';

import { UnprocessableEntityError } from '../../../../shared/errors/unprocessable-entity-error';
import { ValidationError } from '../../../../shared/errors/validation-error';
import { validate } from '../../../identity/infrastructure/dto/validate';

/**
 * Reorder request body (F5 — REQ-P-010, design §11).
 *
 * The schema enforces `.int().positive()` on both `from` and `to` (LOCKED spec
 * REQ-P-010 scenarios "Out-of-range position" + "Non-integer or missing
 * position" — `.int()` rejects `1.5`, `.positive()` rejects `0` and negatives,
 * missing fields surface via Zod's default required-handling). The dynamic
 * max-position bound is the use case's job (it depends on the playlist's
 * current row count) — the DTO can only validate the static shape.
 */
export const reorderSchema = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
});

export type ReorderDto = z.infer<typeof reorderSchema>;

/**
 * Parse the reorder body, re-throwing any Zod-derived `ValidationError` as an
 * `UnprocessableEntityError` so the spec-pinned 422 envelope surfaces
 * (REQ-P-010 — position-shape errors are 422, NOT 400).
 *
 * Mirrors `validate-pagination.ts` → `InvalidPaginationError` (the catalog
 * precedent for swapping Zod issues into a spec-pinned error code). Non-
 * `ValidationError` exceptions pass through untouched.
 */
export function parseReorderBody(input: unknown): ReorderDto {
  try {
    return validate(reorderSchema, input);
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new UnprocessableEntityError('playlist position', 'from/to');
    }
    throw err;
  }
}

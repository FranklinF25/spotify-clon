import { z } from 'zod';

import { MAX_PAGE_INDEX, MAX_PAGE_SIZE } from '../../../../shared/pagination';

/**
 * Pagination query schema for `GET /artists` + `GET /albums` (CAT-PR2b1-01).
 *
 * `page` and `pageSize` are both OPTIONAL — no `.default()` is baked in. The
 * use case applies defaults via `validatePaginationBounds` (single source of
 * truth in `shared/pagination.ts`, R2-W-S2). Baking a default here would let
 * the DTO and the use case drift.
 *
 * Bounds reuse the spec-locked constants `MAX_PAGE_INDEX` + `MAX_PAGE_SIZE`:
 *  - `page` ∈ [1, MAX_PAGE_INDEX]
 *  - `pageSize` ∈ [1, MAX_PAGE_SIZE]
 *
 * `z.coerce.number()` lets `?page=2` query strings parse cleanly. The
 * `validatePagination` wrapper (CAT-PR2b1-03) re-throws Zod issues as
 * `InvalidPaginationError` so the spec-pinned `INVALID_PAGINATION` token
 * reaches the client (NOT the generic `VALIDATION_ERROR`).
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().max(MAX_PAGE_INDEX).optional(),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

export type PaginationDto = z.infer<typeof paginationSchema>;

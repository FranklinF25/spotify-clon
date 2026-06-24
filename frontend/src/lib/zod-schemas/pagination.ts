import { z } from 'zod';

/**
 * Pagination parser (DESIGN §4.2). `z.coerce.number()` so query-string
 * provenance (`?page=2`) parses without a manual cast; defaults keep list
 * endpoints usable with an empty input object (the catalog hooks pass
 * `{ page?, pageSize? }`).
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

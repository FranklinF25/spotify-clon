import { z } from 'zod';

/**
 * Search parser (DESIGN §4.2). `type` is a SINGULAR enum mirroring backend
 * `dto/search.dto.ts` (`z.enum(['artist','album','track']).optional()`) —
 * one group at a time, omit to populate all three. NOT a comma-joined plural
 * (JD fix #1).
 */
export const searchSchema = z.object({
  q: z.string().min(1),
  type: z.enum(['artist', 'album', 'track']).optional(),
});

export type SearchInput = z.infer<typeof searchSchema>;

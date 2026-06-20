import { z } from 'zod';

/**
 * Registration request body. Mirrors the spec:
 *   - email: valid email format (normalization to lowercase happens in the
 *     domain `User.register` factory, so the DTO stays lossless),
 *   - password: min 8 chars, no complexity rules (proposal Decision 2),
 *   - displayName: 1..100 chars (matches the domain invariant).
 *
 * Validation failures surface as a `ValidationError` (see `validate.ts`) with a
 * `details[]` entry whose `field` points at the offending body field.
 */
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
});

export type RegisterDto = z.infer<typeof registerSchema>;

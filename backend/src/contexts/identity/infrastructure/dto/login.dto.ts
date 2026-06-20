import { z } from 'zod';

/**
 * Login request body. Only the shape is enforced here:
 *   - email: must be present and a valid email,
 *   - password: must be non-empty.
 *
 * The password length is NOT re-validated at login (the min-8 policy is a
 * registration concern). Verifying the credential against the stored hash is
 * the use case's job; a too-short password simply fails `verify` and returns
 * the generic `UNAUTHORIZED` (spec: no user enumeration).
 */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginDto = z.infer<typeof loginSchema>;

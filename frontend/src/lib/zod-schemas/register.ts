import { z } from 'zod';

/**
 * Register form validator + runtime contract parser (DESIGN §4.2).
 *
 * The `min(8)` message literal is rendered verbatim by `FormField`
 * (FE-PR2-06) inline — keep it stable.
 */
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
  displayName: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;

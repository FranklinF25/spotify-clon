import { z } from 'zod';

/** Login form validator (DESIGN §4.2). Mirrors registerSchema's password
 * message so `FormField` renders the same inline text in both forms. */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

export type LoginInput = z.infer<typeof loginSchema>;

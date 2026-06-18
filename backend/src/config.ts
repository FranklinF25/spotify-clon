import { z } from 'zod';

/**
 * Boolean parser for env-style "true"/"false" strings.
 * Anything else is a validation error (fail-fast).
 */
const booleanString = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(['true', 'false']))
  .transform((value) => value === 'true');

/**
 * Single source of truth for runtime configuration.
 *
 * Every variable the backend depends on is declared here with a Zod rule.
 * Optional operational values carry safe defaults; security-sensitive and
 * required values (DB url, JWT secrets) MUST be provided by the environment.
 */
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  DATABASE_URL: z.string().url(),

  // JWT — separate secrets, min 32 chars to defeat brute force on symmetric keys.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().regex(/^\d+[smhd]$/).default('15m'),
  JWT_REFRESH_TTL: z.string().regex(/^\d+[smhd]$/).default('7d'),
  JWT_ISSUER: z.string().min(1).default('spotify-clon'),
  JWT_AUDIENCE: z.string().min(1).default('spotify-clon-users'),

  // Refresh cookie — httpOnly always; secure driven by env for local vs prod.
  COOKIE_SECURE: booleanString.default('false'),
  REFRESH_COOKIE_PATH: z.string().default('/api/v1/auth'),

  // argon2id — OWASP 2025 baseline, tunable via env.
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),
});

export type EnvConfig = z.infer<typeof configSchema>;

/**
 * Parse and validate environment variables.
 *
 * Accepts an explicit record (testability) and falls back to `process.env`.
 * Throws a readable validation error before any port is bound so the process
 * fails fast on misconfiguration (spec: "Missing required variable fails fast").
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): EnvConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.') || '(root)';
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

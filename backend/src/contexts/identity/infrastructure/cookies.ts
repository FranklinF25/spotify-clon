/**
 * Refresh-cookie attributes (DESIGN: HttpOnly always; Secure driven by env;
 * SameSite=Lax; Path scoped to the auth routes).
 *
 * Kept as a narrow struct (not the whole `EnvConfig`) so the helper is testable
 * without booting the full Zod config, and so the wiring maps env → this.
 */
export interface CookieConfig {
  secure: boolean;
  path: string;
}

/** Stable cookie name for the rotated refresh credential. */
export const REFRESH_COOKIE_NAME = 'refreshToken';

/**
 * Build Express `res.cookie()` / `res.clearCookie()` options for the refresh
 * token. HttpOnly blocks JS access (XSS defense); SameSite=Lax blocks CSRF on
 * cross-origin POSTs while allowing top-level navigations; Path scopes the
 * cookie (and thus its automatic sending) to the auth routes only.
 */
export function refreshCookieOptions(config: CookieConfig): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
} {
  return {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'lax',
    path: config.path,
  };
}

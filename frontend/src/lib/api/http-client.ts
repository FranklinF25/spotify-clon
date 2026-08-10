import { z } from 'zod';
import { useAuthStore } from '@/store/auth.store';
import { endpoints } from '@/lib/api/endpoints';
import type { ApiErrorCode, RefreshResponse } from '@/types/api';

/**
 * Typed HTTP client (DESIGN §6.1). Owns the four seams reviewers audit:
 *  - Bearer inject (single source of truth: authStore.accessToken)
 *  - zod envelope parse (malformed → GENERIC, never partially trusted)
 *  - single-flight 401 refresh (module-scope `refreshPromise`)
 *  - boot gate (`bootRefreshGate`, bypassed by `skipAuthRefresh`)
 *
 * `request<T>` is the JSON path; `getBlob` is a SEPARATE method returning
 * `await res.blob()` (the binary mp3 CANNOT go through `res.text()` +
 * `JSON.parse` — that UTF-8-decodes the bytes and throws). TypeScript erases
 * types at runtime, so `request<T>` cannot branch on `T === Blob`; the
 * dedicated `getBlob` is the real source of truth.
 */

// --- Error envelope --------------------------------------------------------
export interface ErrorDetail {
  field: string;
  issue: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const GENERIC = (status: number) =>
  new ApiError('UNKNOWN', 'Unexpected error', status);

// The known backend error vocabulary (R-app-2). The wire `code` is a free
// `string`; we coerce anything outside this set to `'UNKNOWN'` so `ApiError.code`
// is always a valid `ApiErrorCode` (the union stays exhaustive at consumption
// sites — `error.code === 'NOT_FOUND'` etc. — without a runtime risk of an
// unrecognised literal slipping through typed as itself).
const KNOWN_CODES: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
  'INVALID_PAGINATION',
  'INVALID_QUERY',
  'UNPROCESSABLE_ENTITY',
  'UNKNOWN',
]);

function toApiErrorCode(wire: string): ApiErrorCode {
  return KNOWN_CODES.has(wire as ApiErrorCode)
    ? (wire as ApiErrorCode)
    : 'UNKNOWN';
}

// zod-validated envelope shape (replaces the hand-rolled typeof check — JD
// fix #16). `safeParse` means a malformed-but-present `error` object (e.g.
// `{ error: 7 }`) falls through to GENERIC instead of being partially trusted.
const envelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z
      .array(
        z.object({
          field: z.string(),
          issue: z.string(),
        }),
      )
      .optional(),
  }),
});

function parseEnvelope(status: number, body: unknown): never {
  const parsed = envelopeSchema.safeParse(body);
  if (parsed.success) {
    throw new ApiError(
      toApiErrorCode(parsed.data.error.code),
      parsed.data.error.message,
      status,
      parsed.data.error.details ?? [],
    );
  }
  throw GENERIC(status); // non-envelope / malformed non-2xx → generic
}

// --- Single-flight refresh state (DESIGN §6.1 — MODULE SCOPE) --------------
// NOT per-call. This is the critical seam: N concurrent 401s hit
// `refreshPromise ??= doRefresh()` and all await the SAME promise. A per-call
// memoisation would issue N refreshes (defeating the whole point).
let refreshPromise: Promise<string> | null = null;
let bootRefreshGate: Promise<void> | null = null;

async function doRefresh(): Promise<string> {
  // try/finally so `refreshPromise` is ALWAYS nulled — even when `fetch`
  // throws (network/DNS reject) or `res.json()` throws (HTML body from a
  // 502). Without this, `refreshPromise ??= doRefresh()` would see a
  // non-nullish rejected promise forever and every subsequent 401 would
  // await it → refresh dead until reload (R2-2b).
  try {
    const res = await fetch(endpoints.auth.refresh, {
      method: 'POST',
      credentials: 'include', // auto-attach the httpOnly cookie (same-origin)
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status === 401) {
      // refresh cookie expired/revoked — clear + redirect (REQ-FE-003).
      useAuthStore.getState()._clear();
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
      throw new ApiError('UNAUTHORIZED', 'session expired', 401);
    }
    if (!res.ok) {
      throw new ApiError('UNKNOWN', 'refresh failed', res.status);
    }
    const data = (await res.json()) as RefreshResponse;
    // hydrate the store with the new access token (user fetched separately
    // on boot via /me; during in-flight refresh we keep the existing user).
    useAuthStore.getState()._hydrateFromRefresh(data.accessToken);
    return data.accessToken;
  } finally {
    refreshPromise = null; // ALWAYS release, even on unexpected throw
  }
}

/**
 * Boot refresh publishes its promise here BEFORE awaiting so a guarded
 * request that mounts during the boot refresh awaits THIS promise, not a
 * doomed 401 (see `refreshOnBoot` in DESIGN §4.3).
 */
export function setBootRefreshGate(p: Promise<void> | null): void {
  bootRefreshGate = p;
}

export interface RequestOptions {
  /**
   * Skip BOTH the boot-gate await AND the 401→refresh interceptor. Used by
   * the boot refresh's OWN calls (POST /auth/refresh AND GET /me) so they
   * don't await/re-enter the gate they're populating (R2-2a self-deadlock),
   * and by public endpoints (register/login) so they fire immediately.
   */
  skipAuthRefresh?: boolean;
  /** Abort the underlying fetch (audio stream skip/unmount — DESIGN §6.3). */
  signal?: AbortSignal;
}

// --- Core JSON request -----------------------------------------------------
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  // Wait for any in-flight boot refresh before issuing a guarded request.
  // HONOR `opts.skipAuthRefresh`: the boot refresh's OWN calls (refresh +
  // /me) pass it so they DON'T await the gate they're populating — else
  // `gate awaits /me; /me awaits gate` self-deadlocks (R2-2a). Public
  // endpoints (register/login) ALSO pass it so they don't block on a gate
  // they don't need.
  if (bootRefreshGate && !opts.skipAuthRefresh) await bootRefreshGate;

  const send = (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(path, {
      method,
      headers,
      credentials: 'include', // cookie path for refresh only; harmless elsewhere
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await send(useAuthStore.getState().accessToken);

  // Single-flight 401 — ONLY ONE refresh, N concurrent 401s share it.
  // Skipped when the caller (the boot refresh / public endpoints) owns its
  // own 401 path via `skipAuthRefresh`.
  if (res.status === 401 && !opts.skipAuthRefresh) {
    refreshPromise ??= doRefresh();
    try {
      const newToken = await refreshPromise; // every concurrent caller awaits here
      res = await send(newToken); // retry exactly once with the fresh token
    } catch (e) {
      // refresh-401 has already cleared the store + redirected inside doRefresh.
      throw e instanceof ApiError
        ? e
        : new ApiError('UNAUTHORIZED', 'session expired', 401);
    }
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  // Wrap JSON.parse: a 502/etc. with an HTML body (or any non-JSON) must NOT
  // throw a SyntaxError here — it must fall through to `parseEnvelope` with
  // `undefined`, yielding GENERIC(status) (REQ-FE-002 non-envelope case).
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) parseEnvelope(res.status, parsed);
  return parsed as T;
}

// --- Blob request (audio stream — the only non-JSON guarded endpoint) -----
// Mirrors `request()`'s structure (Bearer inject, single-flight 401 →
// doRefresh + retry-once honoring `opts.skipAuthRefresh`, gate-honoring,
// abortable) but on success returns `await res.blob()` instead of
// text+JSON.parse. Defined HERE (NOT sketched in §6.3) — `loadBlobSource`
// (FE-PR1-10) is its only caller.
async function getBlob(path: string, opts: RequestOptions = {}): Promise<Blob> {
  if (bootRefreshGate && !opts.skipAuthRefresh) await bootRefreshGate;

  const send = (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(path, {
      method: 'GET',
      headers,
      credentials: 'include',
      signal: opts.signal, // abort on track change / unmount (DESIGN §5.2)
    });
  };

  let res = await send(useAuthStore.getState().accessToken);

  // Single-flight 401 — identical to `request()`. Audio 401 is structurally
  // the same as any other 401: token expired, cookie valid.
  if (res.status === 401 && !opts.skipAuthRefresh) {
    refreshPromise ??= doRefresh();
    try {
      const newToken = await refreshPromise;
      res = await send(newToken); // retry exactly once
    } catch (e) {
      throw e instanceof ApiError
        ? e
        : new ApiError('UNAUTHORIZED', 'session expired', 401);
    }
  }

  if (!res.ok) {
    // Audio streams don't return a JSON envelope; surface a generic ApiError.
    // (Refresh-401 has already cleared+redirected inside doRefresh.)
    throw new ApiError('UNKNOWN', 'stream failed', res.status);
  }
  return res.blob();
}

export const httpClient = {
  get: <T>(path: string, opts?: RequestOptions): Promise<T> =>
    request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>('POST', path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
    request<T>('PATCH', path, body, opts),
  delete: <T>(path: string, opts?: RequestOptions): Promise<T> =>
    request<T>('DELETE', path, undefined, opts),
  getBlob: (path: string, opts?: RequestOptions): Promise<Blob> =>
    getBlob(path, opts),
};

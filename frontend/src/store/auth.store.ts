import { create } from 'zustand';
import type { UserPrimitive } from '@/types/api';

export type AuthStatus =
  | 'idle'
  | 'authenticating'
  | 'authenticated'
  | 'unauthenticated';

/**
 * PR-1 SKELETON (DESIGN §4.3). Contains ONLY the fields + the two internal
 * seam methods the `http-client` (FE-PR1-09) mutates from outside React's
 * render tree. The 4 action methods (`register`/`login`/`logout`/
 * `refreshOnBoot`) + their specs land in FE-PR2-02 — they need the toast
 * store (FE-PR2-01) for the `PROFILE_LOAD_FAILED` non-fatal toast and the
 * full boot-flow wiring.
 *
 * This skeleton exists so the http-client has a real store to call
 * `_clear` / `_hydrateFromRefresh` / read `accessToken` against; the seam
 * behavior is exercised by FE-PR1-09's http-client spec.
 *
 * NO `persist` middleware — the access token is memory-only by design
 * (REQ-FE-006 "Access token is memory-only"). The httpOnly refresh cookie
 * (backend-owned) is the only auth survivor across reloads; the boot refresh
 * rehydrates this store on app boot (FE-PR2-02).
 */
interface AuthState {
  status: AuthStatus;
  user: UserPrimitive | null;
  accessToken: string | null;
  bootRefreshStarted: boolean;
  /** http-client calls this on a refresh-401 (cookie expired/revoked). */
  _clear: () => void;
  /** http-client calls this on a successful single-flight refresh. */
  _hydrateFromRefresh: (accessToken: string, user?: UserPrimitive) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,
  accessToken: null,
  bootRefreshStarted: false,

  _clear: () =>
    set({ status: 'unauthenticated', user: null, accessToken: null }),

  _hydrateFromRefresh: (accessToken, user) =>
    set({
      status: 'authenticated',
      accessToken,
      user: user ?? get().user,
    }),
}));

import { create } from 'zustand';
import type {
  AuthResponse,
  RefreshResponse,
  UserPrimitive,
} from '@/types/api';
import {
  httpClient,
  setBootRefreshGate,
} from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import { useToast } from '@/components/organisms/ToastHost/toast.store';

export type AuthStatus =
  | 'idle'
  | 'authenticating'
  | 'authenticated'
  | 'unauthenticated';

/**
 * authStore (DESIGN §4.3) — memory-only access token (REQ-FE-006) + boot-flow
 * actions (REQ-FE-007). NO `persist` middleware: the access token lives only
 * in memory; the backend-owned httpOnly refresh cookie is the sole auth
 * survivor across reloads, and `refreshOnBoot` rehydrates this store on boot.
 *
 * The two `_`-prefixed seam methods exist because the http-client mutates auth
 * state from outside React's render tree (single-flight refresh success/failure
 * — DESIGN §6.1). The store is the single mutation point; the client calls the
 * seam, never copies state.
 *
 * Boot-flow Judgment-Day fixes encoded here (see refreshOnBoot):
 *  - R2-2a: register/login + POST /auth/refresh + GET /me pass
 *    { skipAuthRefresh: true } so they never await the boot gate (no
 *    self-deadlock: gate awaits /me; /me awaits gate → permanent Splash).
 *  - R2-3: a transient /me failure AFTER a successful refresh keeps the token
 *    + surfaces a non-fatal toast (no logout on flaky wifi).
 *  - logout clear+redirect INSIDE `finally` (JD fix #4).
 */
interface AuthState {
  status: AuthStatus;
  user: UserPrimitive | null;
  accessToken: string | null;
  /** Single-flight at the store level — one boot refresh per page load. */
  bootRefreshStarted: boolean;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
  }) => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshOnBoot: () => Promise<void>;
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

  async register(input) {
    set({ status: 'authenticating' });
    // skipAuthRefresh: register is a PUBLIC endpoint — it must NOT await the
    // boot gate (R2-2a) and owns its own CONFLICT/401 handling.
    const data = await httpClient.post<AuthResponse>(
      endpoints.auth.register,
      input,
      { skipAuthRefresh: true },
    );
    set({ status: 'authenticated', user: data.user, accessToken: data.accessToken });
  },

  async login(input) {
    set({ status: 'authenticating' });
    // skipAuthRefresh: same rationale as register — public endpoint.
    const data = await httpClient.post<AuthResponse>(
      endpoints.auth.login,
      input,
      { skipAuthRefresh: true },
    );
    set({ status: 'authenticated', user: data.user, accessToken: data.accessToken });
  },

  // logout: clear + redirect run INSIDE `finally` so they fire even when the
  // POST throws (network failure, 500, CORS). The session is dead either way.
  async logout() {
    try {
      await httpClient.post(endpoints.auth.logout, {});
    } catch {
      /* network failed — session is dead client-side regardless */
    } finally {
      get()._clear();
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
  },

  // Boot refresh owns the cookie for its duration. Captures its promise and
  // publishes it via setBootRefreshGate BEFORE awaiting so a guarded request
  // that mounts during the boot refresh awaits THIS promise (not a doomed
  // 401). The gate is cleared in `finally`. refresh + /me both pass
  // skipAuthRefresh:true so they do not re-enter the 401 interceptor AND do
  // not await the gate they populate (R2-2a self-deadlock). Stays
  // 'authenticating' until /me resolves so there is no authenticated &&
  // user===null window on the happy path. DISTINGUISHES refresh-failure from
  // /me-failure (R2-3): a flaky /me after a proven refresh keeps the token.
  async refreshOnBoot() {
    if (get().bootRefreshStarted) return; // single-flight at the store level
    set({ bootRefreshStarted: true, status: 'authenticating' });

    const gate = (async () => {
      try {
        const refresh = await httpClient.post<RefreshResponse>(
          endpoints.auth.refresh,
          {},
          { skipAuthRefresh: true }, // boot owns its 401; does not re-enter interceptor
        );
        // refresh returns { accessToken } ONLY — set token, stay authenticating.
        set({ accessToken: refresh.accessToken });
        try {
          // /me MUST NOT await the gate the boot is populating (R2-2a).
          const me = await httpClient.get<UserPrimitive>(endpoints.me, {
            skipAuthRefresh: true,
          });
          set({ status: 'authenticated', user: me });
        } catch {
          // INNER catch (R2-3): /me failed AFTER refresh success — the token
          // was JUST proven valid. A flaky /me MUST NOT logout an authenticated
          // user. Keep the token, land in authenticated && user===null so
          // <RequireAuth> keeps splashing (§8), surface a non-fatal toast.
          set({ status: 'authenticated', user: null });
          useToast.getState().push({
            code: 'PROFILE_LOAD_FAILED',
            message: "Couldn't load your profile — reload to retry.",
          });
        }
      } catch {
        // OUTER catch: the refresh ITSELF failed (refresh-401 / network) — the
        // cookie is genuinely gone → unauthenticated.
        set({ status: 'unauthenticated', user: null, accessToken: null });
      }
    })();

    setBootRefreshGate(gate); // publish BEFORE await
    try {
      await gate;
    } finally {
      setBootRefreshGate(null); // release — later requests don't wait forever
    }
  },

  _clear: () =>
    set({ status: 'unauthenticated', user: null, accessToken: null }),

  _hydrateFromRefresh: (accessToken, user) =>
    set({
      status: 'authenticated',
      accessToken,
      user: user ?? get().user,
    }),
}));

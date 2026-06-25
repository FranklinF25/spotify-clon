import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import {
  ApiError,
  httpClient,
  setBootRefreshGate,
} from '@/lib/api/http-client';
import { useAuthStore } from './auth.store';
import { useToast } from '@/components/organisms/ToastHost/toast.store';

/**
 * FE-PR2-02 — full authStore (DESIGN §4.3). Covers register/login/logout +
 * refreshOnBoot, encoding the boot-flow Judgment-Day fixes:
 *  - R2-2a: register/login + POST /auth/refresh + GET /me all pass
 *    { skipAuthRefresh: true } so public/boot calls never block on the gate
 *    (and /me does not await the gate it is populating — no self-deadlock).
 *  - R2-2b: refreshPromise cleared in finally (asserted at the http-client
 *    layer in PR-1; refreshOnBoot clears setBootRefreshGate in finally here).
 *  - R2-3: a transient /me failure AFTER a successful refresh keeps the token
 *    (no logout on flaky wifi) + pushes a PROFILE_LOAD_FAILED toast.
 *  - logout clear+redirect INSIDE finally (JD fix #4) — fires even on POST 500.
 */

const REFRESH = endpoints.auth.refresh;
const ME = endpoints.me;
const ALBUMS = endpoints.albums.list().replace(/\?.*$/, '');

/**
 * jsdom `Location.assign` is frozen + MSW resolves relative URLs against
 * `window.location.href`. Replace `window.location` with a stub carrying a
 * valid href + a mock `assign` (same pattern as http-client.spec.ts).
 */
const nativeLocation = window.location;
function mockLocationAssign(pathname = '/') {
  const assign = vi.fn();
  const href = `http://localhost${pathname}`;
  Object.defineProperty(window, 'location', {
    value: {
      href,
      origin: 'http://localhost',
      protocol: 'http:',
      host: 'localhost',
      hostname: 'localhost',
      port: '',
      pathname,
      search: '',
      hash: '',
      assign,
      replace: vi.fn(),
      reload: vi.fn(),
      toString: () => href,
    },
    configurable: true,
    writable: true,
  });
  return assign;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setBootRefreshGate(null);
  // Full store reset (mirrors resetStores but this spec owns its isolation).
  useAuthStore.setState({
    status: 'idle',
    user: null,
    accessToken: null,
    bootRefreshStarted: false,
  });
  useToast.setState({ toasts: [] });
  Object.defineProperty(window, 'location', {
    value: nativeLocation,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe('authStore.register / login (REQ-FE-007, R2-2a)', () => {
  it('login sets status=authenticated + stores user + accessToken', async () => {
    const user = { id: 'u1', email: 'a@b.co', displayName: 'Alice' };
    server.use(
      http.post(endpoints.auth.login, () =>
        HttpResponse.json({ accessToken: 'tok-login', user }),
      ),
    );
    await useAuthStore.getState().login({ email: 'a@b.co', password: 'password1' });
    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.accessToken).toBe('tok-login');
    expect(s.user).toEqual(user);
  });

  it('register sets status=authenticated + stores user + accessToken', async () => {
    const user = { id: 'u2', email: 'b@c.co', displayName: 'Bob' };
    server.use(
      http.post(endpoints.auth.register, () =>
        HttpResponse.json({ accessToken: 'tok-reg', user }, { status: 201 }),
      ),
    );
    await useAuthStore
      .getState()
      .register({ email: 'b@c.co', password: 'password1', displayName: 'Bob' });
    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.accessToken).toBe('tok-reg');
    expect(s.user).toEqual(user);
  });

  it('R2-2a: login bypasses a pending boot gate (public endpoint, skipAuthRefresh)', async () => {
    // A never-resolving gate would hang login forever if skipAuthRefresh were absent.
    setBootRefreshGate(new Promise<void>(() => {}));
    server.use(
      http.post(endpoints.auth.login, () =>
        HttpResponse.json({
          accessToken: 'tok',
          user: { id: 'u', email: 'a@b.co', displayName: 'A' },
        }),
      ),
    );
    await expect(
      useAuthStore.getState().login({ email: 'a@b.co', password: 'password1' }),
    ).resolves.toBeUndefined();
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});

describe('authStore.logout (REQ-FE-007, JD fix #4)', () => {
  it('clears the store + redirects to /login on a 204', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'tok',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    });
    const assign = mockLocationAssign();
    server.use(
      http.post(endpoints.auth.logout, () => new HttpResponse(null, { status: 204 })),
    );
    await useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.accessToken).toBeNull();
    expect(s.user).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('JD fix #4: clear + redirect fire EVEN WHEN the POST rejects (500)', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'tok',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    });
    const assign = mockLocationAssign();
    server.use(
      http.post(endpoints.auth.logout, () =>
        HttpResponse.json(
          { error: { code: 'UNKNOWN', message: 'down' } },
          { status: 500 },
        ),
      ),
    );
    await useAuthStore.getState().logout();
    // finally block: clear + redirect fire regardless.
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.accessToken).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login');
  });
});

describe('authStore.refreshOnBoot — happy path (REQ-FE-007 scenario 1)', () => {
  it('refresh 200 → GET /me 200 → status authenticated, accessToken + user populated', async () => {
    let refreshCalls = 0;
    let meCalls = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        return HttpResponse.json({ accessToken: 'boot-token' });
      }),
      http.get(ME, () => {
        meCalls++;
        return HttpResponse.json({
          id: 'u1',
          email: 'a@b.co',
          displayName: 'Alice',
        });
      }),
    );

    await useAuthStore.getState().refreshOnBoot();

    expect(refreshCalls).toBe(1);
    expect(meCalls).toBe(1); // refresh returns {accessToken} only → /me hydrates user
    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.accessToken).toBe('boot-token');
    expect(s.user).toEqual({ id: 'u1', email: 'a@b.co', displayName: 'Alice' });
  });

  it('stays status=authenticating between the refresh-await and the /me-await (no authenticated&&user===null window)', async () => {
    let resolveMe!: () => void;
    const meBlocked = new Promise<void>((r) => {
      resolveMe = r;
    });
    server.use(
      http.post(REFRESH, () => HttpResponse.json({ accessToken: 'boot-token' })),
      http.get(ME, async () => {
        await meBlocked;
        return HttpResponse.json({
          id: 'u1',
          email: 'a@b.co',
          displayName: 'Alice',
        });
      }),
    );

    const pending = useAuthStore.getState().refreshOnBoot();
    // Let refresh resolve; /me is parked on meBlocked.
    await new Promise((r) => setTimeout(r, 20));
    const mid = useAuthStore.getState();
    expect(mid.status).toBe('authenticating'); // NOT authenticated yet
    expect(mid.accessToken).toBe('boot-token'); // refresh set it
    expect(mid.user).toBeNull(); // /me hasn't resolved

    resolveMe();
    await pending;
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});

describe('authStore.refreshOnBoot — refresh-401 (REQ-FE-007 scenario 2)', () => {
  it('refresh 401 → status unauthenticated, no accessToken/user', async () => {
    server.use(
      http.post(REFRESH, () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'no cookie' } },
          { status: 401 },
        ),
      ),
      http.get(ME, () => HttpResponse.json({ id: 'x', email: 'x', displayName: 'x' })),
    );
    await useAuthStore.getState().refreshOnBoot();
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.accessToken).toBeNull();
    expect(s.user).toBeNull();
  });
});

describe('authStore.refreshOnBoot — R2-3 (transient /me failure ≠ logout)', () => {
  it('refresh 200 + /me 500 → keeps accessToken, user null, PROFILE_LOAD_FAILED toast (no logout)', async () => {
    server.use(
      http.post(REFRESH, () => HttpResponse.json({ accessToken: 'boot-token' })),
      http.get(ME, () =>
        HttpResponse.json(
          { error: { code: 'UNKNOWN', message: 'down' } },
          { status: 500 },
        ),
      ),
    );
    await useAuthStore.getState().refreshOnBoot();
    const s = useAuthStore.getState();
    // Token JUST proven valid by refresh — a flaky /me MUST NOT throw it away.
    expect(s.status).toBe('authenticated');
    expect(s.accessToken).toBe('boot-token'); // KEPT, not cleared
    expect(s.user).toBeNull();
    const toasts = useToast.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].code).toBe('PROFILE_LOAD_FAILED');
  });
});

describe('authStore.refreshOnBoot — single-flight + gate lifecycle', () => {
  it('bootRefreshStarted short-circuits a second concurrent call (refresh fires once)', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        return HttpResponse.json({ accessToken: 't' });
      }),
      http.get(ME, () =>
        HttpResponse.json({ id: 'u', email: 'a@b.co', displayName: 'A' }),
      ),
    );
    await Promise.all([
      useAuthStore.getState().refreshOnBoot(),
      useAuthStore.getState().refreshOnBoot(),
    ]);
    expect(refreshCalls).toBe(1);
    // Flag stays true after first run (one boot refresh per page load).
    expect(useAuthStore.getState().bootRefreshStarted).toBe(true);
  });

  it('publishes the gate before await (guarded probe parks mid-flight) + clears it in finally', async () => {
    let resolveMe!: () => void;
    const meBlocked = new Promise<void>((r) => {
      resolveMe = r;
    });
    server.use(
      http.post(REFRESH, () => HttpResponse.json({ accessToken: 't' })),
      http.get(ME, async () => {
        await meBlocked;
        return HttpResponse.json({ id: 'u', email: 'a@b.co', displayName: 'A' });
      }),
      http.get(ALBUMS, () =>
        HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 }),
      ),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const boot = useAuthStore.getState().refreshOnBoot();
    // Refresh resolves; we are in the /me window → gate is published.
    await new Promise((r) => setTimeout(r, 20));

    // A GUARDED probe (no skipAuthRefresh) must PARK on the in-flight gate:
    // it does not reach the network while /me is unresolved.
    const probe = httpClient.get(ALBUMS);
    await new Promise((r) => setTimeout(r, 20));
    const albumsCalledMid = fetchSpy.mock.calls.some((c) =>
      typeof c[0] === 'string' && c[0].includes('/albums'),
    );
    expect(albumsCalledMid).toBe(false); // parked on the gate

    resolveMe();
    await boot;
    await probe; // gate released → probe completes

    const albumsCalledAfter = fetchSpy.mock.calls.some((c) =>
      typeof c[0] === 'string' && c[0].includes('/albums'),
    );
    expect(albumsCalledAfter).toBe(true);

    // Gate cleared in finally: a NEW guarded probe does NOT park.
    let probeResolved = false;
    void httpClient.get(ALBUMS).then(() => {
      probeResolved = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(probeResolved).toBe(true); // fired immediately — gate is null
  });
});

describe('authStore — memory-only access token (REQ-FE-006)', () => {
  it('never writes the access token to localStorage or sessionStorage', async () => {
    server.use(
      http.post(endpoints.auth.login, () =>
        HttpResponse.json({
          accessToken: 'secret-memory-only',
          user: { id: 'u', email: 'a@b.co', displayName: 'A' },
        }),
      ),
    );
    await useAuthStore.getState().login({ email: 'a@b.co', password: 'password1' });
    const lsValues = Object.values(localStorage).join(' ');
    const ssValues = Object.values(sessionStorage).join(' ');
    expect(lsValues).not.toContain('secret-memory-only');
    expect(ssValues).not.toContain('secret-memory-only');
    // No store-internal key writes an access token either.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      expect(key?.toLowerCase()).not.toContain('token');
    }
  });

  it('_clear resets every auth field', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
      accessToken: 'tok',
    });
    useAuthStore.getState()._clear();
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
  });

  it('_hydrateFromRefresh sets authenticated + token, preserving existing user', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
      accessToken: 'old',
    });
    useAuthStore.getState()._hydrateFromRefresh('new');
    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.accessToken).toBe('new');
    expect(s.user).toEqual({ id: 'u', email: 'a@b.co', displayName: 'A' });
  });
});

describe('authStore — error surfacing', () => {
  it('login surfaces an ApiError (caller/form owns it)', async () => {
    server.use(
      http.post(endpoints.auth.login, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'bad',
              details: [{ field: 'email', issue: 'invalid' }],
            },
          },
          { status: 400 },
        ),
      ),
    );
    await expect(
      useAuthStore.getState().login({ email: 'bad', password: 'password1' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

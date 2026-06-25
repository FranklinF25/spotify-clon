import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { http, HttpResponse } from 'msw';
import { StrictMode } from 'react';
import { render } from '@/test/render';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import { setBootRefreshGate } from '@/lib/api/http-client';
import { Boot } from '@/app/providers';

/**
 * FE-PR2-03 — `useSilentRefresh` hook + `<Boot/>` (DESIGN §5.3).
 *
 * `<Boot/>` is mounted ONCE at the root, OUTSIDE `<RouterProvider>` (and thus
 * outside `<RequireAuth>`), so the silent refresh runs regardless of the first
 * route — a deep-link to `/login` still triggers it. The store's
 * `bootRefreshStarted` flag is the single-flight seam that keeps the refresh
 * to exactly one even under React Strict Mode's dev double-invoke.
 */
const REFRESH = endpoints.auth.refresh;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setBootRefreshGate(null);
  useAuthStore.setState({
    status: 'idle',
    user: null,
    accessToken: null,
    bootRefreshStarted: false,
  });
});
afterAll(() => server.close());

describe('<Boot/> (useSilentRefresh)', () => {
  it('triggers refreshOnBoot exactly once on mount', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        return HttpResponse.json({ accessToken: 't' });
      }),
      http.get(endpoints.me, () =>
        HttpResponse.json({ id: 'u', email: 'a@b.co', displayName: 'A' }),
      ),
    );

    const { unmount } = render(<Boot />);
    // Let the boot refresh (POST + GET /me) flush.
    await new Promise((r) => setTimeout(r, 40));
    expect(refreshCalls).toBe(1);
    unmount();
  });

  it('renders null (no visible DOM output)', () => {
    server.use(
      http.post(REFRESH, () => HttpResponse.json({ accessToken: 't' })),
      http.get(endpoints.me, () =>
        HttpResponse.json({ id: 'u', email: 'a@b.co', displayName: 'A' }),
      ),
    );
    const { container } = render(<Boot />);
    expect(container.innerHTML).toBe('');
  });

  it('still fires the refresh only ONCE under React Strict Mode (bootRefreshStarted guard)', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        return HttpResponse.json({ accessToken: 't' });
      }),
      http.get(endpoints.me, () =>
        HttpResponse.json({ id: 'u', email: 'a@b.co', displayName: 'A' }),
      ),
    );

    // StrictMode double-invokes effects in dev (Vitest uses the dev React
    // build). The bootRefreshStarted flag must collapse both invocations to a
    // single refresh — else a re-mount would re-authenticate from scratch.
    const { unmount } = render(
      <StrictMode>
        <Boot />
      </StrictMode>,
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(refreshCalls).toBe(1);
    unmount();
  });

  it('triggers the refresh with no router context present (route-independent)', async () => {
    // Boot is mounted outside the route tree in providers.tsx; proving it fires
    // with no router context at all is the behavioral proof of route-independence
    // (a deep-link to /login still boots because Boot is a sibling of the router).
    let refreshCalls = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        return HttpResponse.json({ accessToken: 't' });
      }),
      http.get(endpoints.me, () =>
        HttpResponse.json({ id: 'u', email: 'a@b.co', displayName: 'A' }),
      ),
    );
    const { unmount } = render(
      <StrictMode>
        <Boot />
      </StrictMode>,
      { routeInitialEntries: ['/login'] },
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(refreshCalls).toBe(1);
    unmount();
  });
});

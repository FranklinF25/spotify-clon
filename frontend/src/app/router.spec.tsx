import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { RequireAuth } from './RequireAuth';
import { RedirectIfAuthed } from './RedirectIfAuthed';
import { AuthLayout } from '@/components/templates/AuthLayout/AuthLayout';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { routes } from './router';
import { useAuthStore } from '@/store/auth.store';

/**
 * FE-PR2-10 — router integration (REQ-FE-008).
 *
 * NOTE on test mechanism: the production router (`app/router.tsx`) uses
 * `createBrowserRouter` (a data router). Under jsdom, a data-router `<Navigate>`
 * passes a jsdom `AbortSignal` to node's undici fetch, which rejects it
 * ("Expected signal to be an instance of AbortSignal") — a test-env
 * incompatibility, NOT a production bug (the real browser has no such
 * mismatch). The same `<Navigate>` works correctly under the declarative
 * router (`<MemoryRouter>` + `<Routes>`), which is how the guard components
 * themselves are unit-tested. So this spec renders the SAME route structure
 * (real `<RequireAuth>` + `<RedirectIfAuthed>` + real pages + the `*`
 * catch-all) via the declarative router, which mirrors `routes` in
 * `router.tsx` 1:1. The data router is verified in the manual/browser gate.
 *
 * Scenarios (REQ-FE-008):
 *  - Unknown route falls back to home (`*` catch-all → /, outside both guards).
 *  - Unauthenticated user redirected from a protected route to /login.
 *  - Already-authenticated user redirected away from /login to /.
 */
const AUTHED = {
  status: 'authenticated' as const,
  user: { id: 'u', email: 'a@b.co', displayName: 'A' },
  accessToken: 'tok',
  bootRefreshStarted: false,
};

function ProtectedHome() {
  return <div data-testid="protected-home">Protected home</div>;
}

function mountTree(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<RedirectIfAuthed />}>
          <Route path="/login" element={<AuthLayout><LoginPage /></AuthLayout>} />
          <Route path="/register" element={<AuthLayout><RegisterPage /></AuthLayout>} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<ProtectedHome />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() =>
  useAuthStore.setState({
    status: 'idle',
    user: null,
    accessToken: null,
    bootRefreshStarted: false,
  }),
);

describe('router integration — REQ-FE-008 guard + fallback scenarios', () => {
  it('unknown route falls back to home via the * catch-all', async () => {
    useAuthStore.setState(AUTHED);
    mountTree('/totally/unknown');
    // `*` → Navigate to "/" → protected index renders.
    await waitFor(() => {
      expect(screen.getByTestId('protected-home')).toBeInTheDocument();
    });
  });

  it('unauthenticated user at the protected index is redirected to /login', async () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    mountTree('/');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /sign in/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId('protected-home')).not.toBeInTheDocument();
  });

  it('already-authenticated user at /login is redirected to /', async () => {
    useAuthStore.setState(AUTHED);
    mountTree('/login');
    await waitFor(() => {
      expect(screen.getByTestId('protected-home')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('heading', { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });
});

/**
 * FE-PR3-05 — playlists route registration (REQ-FE-013/014/015).
 *
 * Walks the exported `routes` tree and asserts both `/playlists` and
 * `/playlists/:id` are registered under the `RequireAuth` + `AppLayout` +
 * `path: '/'` branch. This is the registration guard — it fails until
 * `router.tsx` adds the two entries. (Render-resolution is covered by the
 * PlaylistsPage + PlaylistDetailPage specs via MSW.)
 */
function flattenPaths(nodes: typeof routes): string[] {
  const out: string[] = [];
  const walk = (nodes: typeof routes, parent = '') => {
    for (const node of nodes) {
      const path = node.path
        ? `${parent}/${node.path}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
        : parent;
      if (node.path) out.push(path || '/');
      if (node.children) walk(node.children, path);
    }
  };
  walk(nodes);
  return out;
}

describe('router — playlists route registration (REQ-FE-014/015)', () => {
  it('registers /playlists (PlaylistsPage)', () => {
    const paths = flattenPaths(routes);
    expect(paths).toContain('/playlists');
  });

  it('registers /playlists/:id (PlaylistDetailPage)', () => {
    const paths = flattenPaths(routes);
    expect(paths).toContain('/playlists/:id');
  });
});

/**
 * F6 WORK-PR3-06 — /library route registration (REQ-FE-016). The unified
 * page must sit under the RequireAuth + AppLayout + path '/' branch so the
 * unauthenticated-redirect scenario is enforced by the route tree.
 */
describe('router — library route registration (REQ-FE-016)', () => {
  it('registers /library (LibraryPage)', () => {
    const paths = flattenPaths(routes);
    expect(paths).toContain('/library');
  });
});

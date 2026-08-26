import { afterEach, describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { RequireAuth } from './RequireAuth';
import { RedirectIfAuthed } from './RedirectIfAuthed';
import { AuthLayout } from '@/components/templates/AuthLayout/AuthLayout';
import { LandingPage } from '@/pages/LandingPage';
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
 * Scenarios (REQ-FE-008 — `/` is the PUBLIC landing, /home is the app home):
 *  - Unauthenticated visitor at `/` sees the public landing page.
 *  - Authenticated visitor at `/` is bounced to the app home /home.
 *  - Unauthenticated user at /home (or a protected deep link) is redirected
 *    to /login (from-state preservation is unit-covered in RequireAuth.spec).
 *  - Already-authenticated user at /login is bounced to /home.
 *  - Unknown route falls back (`*` catch-all → "/": unauthed → landing,
 *    authed → /home via the gate).
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

function ProtectedAlbum() {
  return <div data-testid="protected-album">Protected album</div>;
}

function mountTree(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<RedirectIfAuthed />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<AuthLayout><LoginPage /></AuthLayout>} />
          <Route path="/register" element={<AuthLayout><RegisterPage /></AuthLayout>} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/home" element={<ProtectedHome />} />
          <Route path="/albums/:id" element={<ProtectedAlbum />} />
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
  it('unauthenticated visitor at `/` sees the public landing', async () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    mountTree('/');
    // The landing headline renders — NOT the login form, NOT the app home.
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /streaming app for the library you already own/i,
        }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('heading', { name: /sign in/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('protected-home')).not.toBeInTheDocument();
  });

  it('authenticated visitor at `/` is bounced to the app home /home', async () => {
    useAuthStore.setState(AUTHED);
    mountTree('/');
    await waitFor(() => {
      expect(screen.getByTestId('protected-home')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('heading', {
        level: 1,
        name: /streaming app for the library you already own/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('unauthenticated user at /home is redirected to /login', async () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    mountTree('/home');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /sign in/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId('protected-home')).not.toBeInTheDocument();
  });

  it('unauthenticated deep link to /albums/:id is redirected to /login', async () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    mountTree('/albums/123');
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /sign in/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId('protected-album')).not.toBeInTheDocument();
  });

  it('already-authenticated user at /login is redirected to /home', async () => {
    useAuthStore.setState(AUTHED);
    mountTree('/login');
    await waitFor(() => {
      expect(screen.getByTestId('protected-home')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('heading', { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });

  it('unknown route falls back to `/` — authed visitors reach /home via the gate', async () => {
    useAuthStore.setState(AUTHED);
    mountTree('/totally/unknown');
    // `*` → Navigate to "/" → RedirectIfAuthed (authed) → /home renders.
    await waitFor(() => {
      expect(screen.getByTestId('protected-home')).toBeInTheDocument();
    });
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

/**
 * Public-root restructure — `/` is the landing, /home is the app home
 * (REQ-FE-008 route split). Registration guards: they fail until
 * `router.tsx` hosts LandingPage at `/` inside the RedirectIfAuthed group
 * and moves HomePage off the root index onto `home`.
 */
describe('router — public landing + app home registration (REQ-FE-008)', () => {
  it('registers the LandingPage at `/` under the RedirectIfAuthed group', () => {
    // Structural check on the exported tree: the first branch is the
    // public group and `/` lives inside it (flattenPaths alone cannot
    // prove WHICH guard owns the path).
    const publicBranch = routes[0]?.element;
    expect(isValidElement(publicBranch) ? publicBranch.type : undefined).toBe(
      RedirectIfAuthed,
    );
    const publicPaths = (routes[0]?.children ?? []).map((r) => r.path);
    expect(publicPaths).toEqual(expect.arrayContaining(['/', '/login', '/register']));
  });

  it('registers the app home at /home (HomePage moved off the root index)', () => {
    const paths = flattenPaths(routes);
    expect(paths).toContain('/home');
    // The protected branch keeps NO index route — URL `/` resolves ONLY to
    // the public landing. (The protected `path: '/'` node remains as the
    // parent of home/albums/... so flattenPaths legitimately lists '/' twice;
    // what must NOT exist is an index child under it.)
    const indexRoutes: string[] = [];
    const walk = (nodes: typeof routes) => {
      for (const node of nodes) {
        if (node.index) indexRoutes.push(node.path ?? '(pathless)');
        if (node.children) walk(node.children);
      }
    };
    walk(routes);
    expect(indexRoutes).toEqual([]);
  });
});

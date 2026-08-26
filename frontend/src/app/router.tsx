import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import { RedirectIfAuthed } from './RedirectIfAuthed';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { LandingPage } from '@/pages/LandingPage';
import { HomePage } from '@/pages/HomePage';
import { AlbumPage } from '@/pages/AlbumPage';
import { ArtistPage } from '@/pages/ArtistPage';
import { SearchPage } from '@/pages/SearchPage';
import { UploadPage } from '@/pages/UploadPage';
import { PlaylistsPage } from '@/pages/PlaylistsPage';
import { PlaylistDetailPage } from '@/pages/PlaylistDetailPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { AuthLayout } from '@/components/templates/AuthLayout/AuthLayout';
import { AppLayout } from '@/components/templates/AppLayout/AppLayout';

/**
 * Route table (DESIGN §8, REQ-FE-008). Exported so the router spec builds a
 * `createMemoryRouter`-shaped declarative mirror from the SAME definitions
 * the production `createBrowserRouter` uses.
 *
 *  - PUBLIC root: `/` hosts the marketing LandingPage under
 *    `<RedirectIfAuthed>` (unauthenticated → landing; authenticated →
 *    `<Navigate to="/home">`). /login + /register stay in the same group,
 *    wrapped by `<AuthLayout>` (the centered-card public shell).
 *  - Protected routes sit under `<RequireAuth>` + `<AppLayout>` (Sidebar +
 *    Topbar + Outlet + PlayerBar). The nested children:
 *      /home            HomePage (featured albums — REQ-FE-009). The app home
 *                       moved OFF the root index so `/` can serve the public
 *                       landing; `<RedirectIfAuthed>` bounces authed visitors
 *                       from `/` to here.
 *      /albums/:id      AlbumPage (tracks + queue seeding — REQ-FE-009)
 *      /artists/:id     ArtistPage (embedded albums — REQ-FE-009)
 *      /search          SearchPage (PLACEHOLDER — real impl lands FE-PR4-06)
 *      /upload          UploadPage (multi-file track upload — REQ-UPLOAD-002)
 *      /playlists       PlaylistsPage (owner list — REQ-FE-014, PR-3)
 *      /playlists/:id   PlaylistDetailPage (tracks + play handoff — REQ-FE-015)
 *      /library         LibraryPage (unified view — REQ-FE-016, F6)
 *    React Router keeps AppLayout mounted across these transitions
 *    (REQ-FE-008 "PlayerBar mounted exactly once" depends on this in PR-4).
 *  - The `*` catch-all is OUTSIDE both guard parents so unknown routes
 *    redirect to "/" regardless of auth state: unauthenticated visitors land
 *    on the public landing; authenticated ones are routed onward to /home by
 *    `<RedirectIfAuthed>`.
 *
 * NOTE: data-router `<Navigate>` + jsdom's AbortSignal is covered in the spec
 * comment (router.spec.tsx) — the declarative router drives the integration
 * scenarios; the data router is verified in the manual/browser gate.
 */
export const routes: RouteObject[] = [
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/login', element: <AuthLayout><LoginPage /></AuthLayout> },
      { path: '/register', element: <AuthLayout><RegisterPage /></AuthLayout> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: '/',
            children: [
              { path: 'home', element: <HomePage /> },
              { path: 'albums/:id', element: <AlbumPage /> },
              { path: 'artists/:id', element: <ArtistPage /> },
              { path: 'search', element: <SearchPage /> },
              { path: 'upload', element: <UploadPage /> },
              { path: 'playlists', element: <PlaylistsPage /> },
              { path: 'playlists/:id', element: <PlaylistDetailPage /> },
              { path: 'library', element: <LibraryPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes);

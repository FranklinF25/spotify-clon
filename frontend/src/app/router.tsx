import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import { RedirectIfAuthed } from './RedirectIfAuthed';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { AuthLayout } from '@/components/templates/AuthLayout/AuthLayout';

/**
 * Route table (DESIGN §8, REQ-FE-008). Exported so the router spec builds a
 * `createMemoryRouter` from the SAME definitions the production
 * `createBrowserRouter` uses.
 *
 *  - Public routes (/login, /register) sit under `<RedirectIfAuthed>` +
 *    `<AuthLayout>` (the centered-card public shell).
 *  - Protected routes sit under `<RequireAuth>`. The real `AppLayout` + the
 *    Home/Album/Artist/Search pages land in PR-3; for now a single protected
 *    index placeholder stands in so the guard is demonstrable end-to-end
 *    against MSW.
 *  - The `*` catch-all is OUTSIDE both guard parents so unknown routes
 *    redirect to "/" regardless of auth state.
 *
 * NOTE: data-router `<Navigate>` + jsdom's AbortSignal is covered in the spec
 * comment (router.spec.tsx) — the declarative router drives the integration
 * scenarios; the data router is verified in the manual/browser gate.
 */
export const routes: RouteObject[] = [
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/login', element: <AuthLayout><LoginPage /></AuthLayout> },
      { path: '/register', element: <AuthLayout><RegisterPage /></AuthLayout> },
    ],
  },
  {
    element: <RequireAuth />,
    // PR-3 swaps this placeholder for <AppLayout/> + Home/Album/Artist/Search.
    children: [
      {
        index: true,
        element: <div data-testid="protected-home">Protected home</div>,
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes);

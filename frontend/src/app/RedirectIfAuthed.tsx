import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { Splash } from '@/components/organisms/Splash';

/**
 * `<RedirectIfAuthed>` (DESIGN §8, REQ-FE-008). Wraps the public routes
 * (/login, /register) so an already-authenticated user is bounced to the app
 * instead of seeing the auth form.
 *
 *  - idle | authenticating → <Splash/> (R2-7: rendering the form during boot
 *    causes a flash-of-login-then-redirect-away when the silent refresh
 *    succeeds. Splash until the boot settles to a definite state, for
 *    consistency with `<RequireAuth>`.)
 *  - authenticated → <Navigate to="/" replace/>.
 *  - unauthenticated → <Outlet/> (login/register form renders).
 *
 * Shares the single `<Splash/>` organism with `<RequireAuth>` — no duplication.
 */
export function RedirectIfAuthed() {
  const status = useAuthStore((s) => s.status);

  if (status === 'idle' || status === 'authenticating') {
    return <Splash />;
  }
  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

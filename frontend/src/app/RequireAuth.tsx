import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { Splash } from '@/components/organisms/Splash';

/**
 * `<RequireAuth>` (DESIGN §8, REQ-FE-008). Guards the protected route tree.
 *
 *  - unauthenticated → redirect to /login, preserving the requested route in
 *    `location.state.from` so `<LoginPage>` can return the user after a
 *    successful login (R2-8: a deep-link to /albums/:id while logged out
 *    returns there, not to the app home at /home).
 *  - authenticated && user → render the protected `<Outlet/>`.
 *  - otherwise (idle | authenticating | authenticated && user===null) → Splash.
 *    Splash during boot prevents a protected data fetch from racing the boot
 *    refresh. Splash on `authenticated && user===null` covers BOTH the /me-
 *    await window (refresh set the token but /me hasn't resolved) AND the R2-3
 *    case where /me transiently failed but the token is kept (§4.3).
 */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (status === 'authenticated' && user) {
    return <Outlet />;
  }
  return <Splash />;
}

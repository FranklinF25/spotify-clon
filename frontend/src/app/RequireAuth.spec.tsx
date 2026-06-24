import { describe, expect, it } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { render } from '@/test/render';
import { useAuthStore } from '@/store/auth.store';
import { RequireAuth } from './RequireAuth';

/**
 * FE-PR2-04 — `<RequireAuth>` guard (DESIGN §8, REQ-FE-008).
 *
 * Branches:
 *  - unauthenticated → <Navigate to="/login" replace state={{ from: location }}/>
 *    (R2-8: preserve the requested route so LoginPage redirects back post-login).
 *  - authenticated && user → <Outlet/> (protected tree renders).
 *  - idle | authenticating | authenticated && user===null → <Splash/>
 *    (JD fix #3/#12 + R2-3: splash during boot AND during the /me-await window,
 *    including the transient /me-failure case where the token is kept).
 */
function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from;
  return <div data-testid="login-probe">{from?.pathname ?? 'no-from'}</div>;
}

function ProtectedTree() {
  return <div data-testid="protected">PROTECTED CONTENT</div>;
}

function mountAt(route: string) {
  return render(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/albums/:id" element={<ProtectedTree />} />
      </Route>
      <Route path="/login" element={<LoginProbe />} />
    </Routes>,
    { routeInitialEntries: [route] },
  );
}

describe('<RequireAuth>', () => {
  it('redirects an unauthenticated user to /login and preserves the requested route (R2-8)', () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    mountAt('/albums/123');

    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(screen.getByTestId('login-probe')).toHaveTextContent('/albums/123');
  });

  it('renders the protected Outlet when authenticated with a user', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    });
    mountAt('/albums/123');
    expect(screen.getByTestId('protected')).toBeInTheDocument();
  });

  it('shows Splash on status=idle', () => {
    useAuthStore.setState({ status: 'idle', user: null });
    mountAt('/albums/123');
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('shows Splash on status=authenticating', () => {
    useAuthStore.setState({ status: 'authenticating', user: null });
    mountAt('/albums/123');
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('shows Splash on authenticated && user===null (the /me-await / R2-3 window)', () => {
    // refresh succeeded (token proven valid) but /me hasn't resolved yet, OR
    // /me transiently failed (R2-3) — keep splashing, never render the tree.
    useAuthStore.setState({ status: 'authenticated', user: null, accessToken: 't' });
    mountAt('/albums/123');
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });
});

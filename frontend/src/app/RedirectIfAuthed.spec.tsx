import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { render } from '@/test/render';
import { useAuthStore } from '@/store/auth.store';
import { RedirectIfAuthed } from './RedirectIfAuthed';

/**
 * FE-PR2-05 — `<RedirectIfAuthed>` guard (DESIGN §8, REQ-FE-008).
 *
 * Wraps the public routes (`/` landing, /login, /register):
 *  - idle | authenticating → <Splash/> (R2-7: avoid a flash-of-login-then-
 *    redirect-away when the silent refresh succeeds; splash until boot settles).
 *  - authenticated → <Navigate to="/home" replace/> (the app home; the
 *    public surfaces do NOT render).
 *  - unauthenticated → <Outlet/> (the landing / login / register form renders).
 */
function PublicForm() {
  return <div data-testid="public-form">LOGIN CARD</div>;
}

function HomeProbe() {
  return <div data-testid="home">HOME</div>;
}

function mountAt(route: string) {
  return render(
    <Routes>
      <Route element={<RedirectIfAuthed />}>
        <Route path="/login" element={<PublicForm />} />
      </Route>
      <Route path="/home" element={<HomeProbe />} />
    </Routes>,
    { routeInitialEntries: [route] },
  );
}

describe('<RedirectIfAuthed>', () => {
  it('renders the public form when unauthenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated', user: null });
    mountAt('/login');
    expect(screen.getByTestId('public-form')).toBeInTheDocument();
  });

  it('redirects an authenticated user to /home and does NOT render the login card (REQ-FE-008)', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    });
    mountAt('/login');
    expect(screen.queryByTestId('public-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });

  it('shows Splash on status=idle (R2-7: no flash-of-login)', () => {
    useAuthStore.setState({ status: 'idle', user: null });
    mountAt('/login');
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByTestId('public-form')).not.toBeInTheDocument();
  });

  it('shows Splash on status=authenticating (R2-7: boot consistency)', () => {
    useAuthStore.setState({ status: 'authenticating', user: null });
    mountAt('/login');
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByTestId('public-form')).not.toBeInTheDocument();
  });
});

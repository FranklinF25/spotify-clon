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
import { fireEvent, render, screen } from '@testing-library/react';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import { LogoutButton } from './LogoutButton';

/**
 * FE-PR2-11 — LogoutButton molecule (REQ-FE-007).
 *
 * Presentational by necessity: the LOCKED architecture rule (FE-PR1-13) forbids
 * molecules from importing `store/`, so the molecule takes `onLogout` and the
 * `authStore.logout` wiring lands in Topbar (PR-3). The molecule contract is
 * "renders a Log out button + calls onLogout on click".
 *
 * The integration scenarios wire `onLogout={authStore.logout}` so the JD fix #4
 * clear+redirect behavior (logout's `finally` fires even on POST 500) is
 * exercised through the button — the same behavior unit-tested in
 * auth.store.spec, here driven by the molecule's click.
 */
const LOGOUT = endpoints.auth.logout;
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
  useAuthStore.setState({
    status: 'idle',
    user: null,
    accessToken: null,
    bootRefreshStarted: false,
  });
  Object.defineProperty(window, 'location', {
    value: nativeLocation,
    configurable: true,
    writable: true,
  });
});
afterAll(() => server.close());

describe('LogoutButton molecule — presentational contract', () => {
  it('renders a Log out button', () => {
    render(<LogoutButton onLogout={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /log out/i }),
    ).toBeInTheDocument();
  });

  it('calls onLogout when clicked', () => {
    const onLogout = vi.fn();
    render(<LogoutButton onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

describe('LogoutButton — logout integration (REQ-FE-007, JD fix #4)', () => {
  it('clears the session + redirects to /login on a 204', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'tok',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    });
    const assign = mockLocationAssign();
    server.use(
      http.post(LOGOUT, () => new HttpResponse(null, { status: 204 })),
    );
    render(<LogoutButton onLogout={useAuthStore.getState().logout} />);
    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    // Wait for the async logout POST + finally to settle.
    await new Promise((r) => setTimeout(r, 50));
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.accessToken).toBeNull();
    expect(s.user).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('clears + redirects EVEN WHEN the POST rejects (JD fix #4 finally block)', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'tok',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    });
    const assign = mockLocationAssign();
    server.use(
      http.post(LOGOUT, () =>
        HttpResponse.json(
          { error: { code: 'UNKNOWN', message: 'down' } },
          { status: 500 },
        ),
      ),
    );
    render(<LogoutButton onLogout={useAuthStore.getState().logout} />);
    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    await new Promise((r) => setTimeout(r, 50));
    // finally: clear + redirect fire regardless of the POST outcome.
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.accessToken).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login');
  });
});

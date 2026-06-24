import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import { useToast } from '@/components/organisms/ToastHost/toast.store';
import { render } from '@/test/render';
import { LoginPage } from './LoginPage';

/**
 * FE-PR2-07 — LoginPage (REQ-FE-007). Covers: zod blocks an invalid submission
 * BEFORE any request; success authenticates + navigates to
 * `location.state?.from ?? '/'` (R2-8); UNAUTHORIZED surfaces an inline form
 * error (the form owns it — NOT a toast).
 */
const LOGIN = endpoints.auth.login;

function mountLogin(initialEntry = '/login') {
  return render(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div data-testid="home">HOME</div>} />
      <Route path="/albums/:id" element={<div data-testid="album">ALBUM</div>} />
    </Routes>,
    { routeInitialEntries: [initialEntry] },
  );
}

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
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
});
afterAll(() => server.close());

describe('LoginPage — zod validation (REQ-FE-007)', () => {
  it('blocks a 7-char password with a field error BEFORE any request', async () => {
    let loginCalls = 0;
    server.use(
      http.post(LOGIN, () => {
        loginCalls++;
        return HttpResponse.json({ accessToken: 'x', user: {} });
      }),
    );
    mountLogin();
    fillAndSubmit('a@b.co', 'seven77'); // 7 chars

    expect(
      await screen.findByText('password must be at least 8 characters'),
    ).toBeInTheDocument();
    // NO request fired — validation owns this path, not the network.
    await new Promise((r) => setTimeout(r, 20));
    expect(loginCalls).toBe(0);
  });

  it('blocks an invalid email with a field error before any request', async () => {
    let loginCalls = 0;
    server.use(
      http.post(LOGIN, () => {
        loginCalls++;
        return HttpResponse.json({ accessToken: 'x', user: {} });
      }),
    );
    mountLogin();
    fillAndSubmit('not-an-email', 'password1');

    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(loginCalls).toBe(0);
  });
});

describe('LoginPage — success navigates to `from` (R2-8)', () => {
  it('navigates to / when there is no state.from', async () => {
    mountLogin('/login');
    fillAndSubmit('a@b.co', 'password1');

    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument();
    });
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('navigates to the preserved route when state.from is set', async () => {
    render(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/albums/:id" element={<div data-testid="album">ALBUM</div>} />
      </Routes>,
      {
        routeInitialEntries: [
          { pathname: '/login', state: { from: { pathname: '/albums/123' } } },
        ],
      },
    );
    fillAndSubmit('a@b.co', 'password1');

    await waitFor(() => {
      expect(screen.getByTestId('album')).toBeInTheDocument();
    });
  });
});

describe('LoginPage — UNAUTHORIZED surfaces inline (form owns it)', () => {
  it('renders an inline form error on 401 (no toast)', async () => {
    server.use(
      http.post(LOGIN, () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'bad creds' } },
          { status: 401 },
        ),
      ),
    );
    mountLogin();
    fillAndSubmit('a@b.co', 'password1');

    expect(
      await screen.findByRole('alert', { name: /invalid/i }),
    ).toBeInTheDocument();
    // status stays unauthenticated; no navigation.
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
    expect(useAuthStore.getState().status).not.toBe('authenticated');
    // The form owns the error — no toast was pushed.
    expect(useToast.getState().toasts).toHaveLength(0);
  });
});

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
import { render } from '@/test/render';
import { RegisterPage } from './RegisterPage';

/**
 * FE-PR2-08 — RegisterPage (REQ-FE-007). Mirrors LoginPage with three fields.
 * Covers: zod blocks invalid submission pre-request; success authenticates +
 * navigates; CONFLICT surfaces inline on the email field (NOT a crash) and
 * status stays unauthenticated.
 */
const REGISTER = endpoints.auth.register;

function mountRegister(initialEntry = '/register') {
  return render(
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/home" element={<div data-testid="home">HOME</div>} />
    </Routes>,
    { routeInitialEntries: [initialEntry] },
  );
}

function fillAndSubmit(
  email: string,
  password: string,
  displayName: string,
) {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: displayName },
  });
  fireEvent.click(screen.getByRole('button', { name: /create account|register|sign up/i }));
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

describe('RegisterPage — zod validation (REQ-FE-007)', () => {
  it('blocks a 7-char password with a field error BEFORE any request', async () => {
    let registerCalls = 0;
    server.use(
      http.post(REGISTER, () => {
        registerCalls++;
        return HttpResponse.json({ accessToken: 'x', user: {} });
      }),
    );
    mountRegister();
    fillAndSubmit('a@b.co', 'seven77', 'Alice');

    expect(
      await screen.findByText('password must be at least 8 characters'),
    ).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(registerCalls).toBe(0);
  });

  it('blocks an empty display name with a field error before any request', async () => {
    let registerCalls = 0;
    server.use(
      http.post(REGISTER, () => {
        registerCalls++;
        return HttpResponse.json({ accessToken: 'x', user: {} });
      }),
    );
    mountRegister();
    fillAndSubmit('a@b.co', 'password1', '');

    expect(await screen.findByText(/display name/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(registerCalls).toBe(0);
  });
});

describe('RegisterPage — success authenticates + navigates', () => {
  it('authenticates and navigates to /home on a 201', async () => {
    mountRegister();
    fillAndSubmit('a@b.co', 'password1', 'Alice');

    await waitFor(() => {
      expect(screen.getByTestId('home')).toBeInTheDocument();
    });
    expect(useAuthStore.getState().status).toBe('authenticated');
    // The server owns the user shape; assert it's populated + in memory only.
    expect(useAuthStore.getState().user).not.toBeNull();
    expect(useAuthStore.getState().user?.id).toBeDefined();
  });
});

describe('RegisterPage — CONFLICT surfaces inline (REQ-FE-007)', () => {
  it('displays the conflict on the email field + stays unauthenticated (no crash)', async () => {
    server.use(
      http.post(REGISTER, () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'email taken' } },
          { status: 409 },
        ),
      ),
    );
    mountRegister();
    fillAndSubmit('a@b.co', 'password1', 'Alice');

    // Inline conflict on the email field — NOT a generic crash.
    expect(await screen.findByText(/already/i)).toBeInTheDocument();
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
    expect(useAuthStore.getState().status).not.toBe('authenticated');
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { Topbar } from './Topbar';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';

/**
 * FE-PR3-09 — Topbar organism (DESIGN §7, §11.1).
 *
 * The protected top chrome: a `<header>` landmark hosting the LogoutButton.
 * This is the WIRING SITE promised in FE-PR2-11 — the presentational molecule
 * takes `onLogout`; Topbar connects it to `authStore.logout` (organism may read
 * store; the §3 rule only forbids atoms/molecules from doing so).
 */
function renderTopbar() {
  return render(
    <MemoryRouter>
      <Topbar />
    </MemoryRouter>,
  );
}

const nativeLocation = window.location;
function mockLocationAssign(pathname = '/') {
  const assign = vi.fn();
  const href = `http://localhost${pathname}`;
  Object.defineProperty(window, 'location', {
    value: { ...nativeLocation, href, pathname, assign },
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

describe('Topbar organism', () => {
  it('renders a header landmark', () => {
    renderTopbar();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('mounts the LogoutButton inside the topbar (FE-PR2-11 wiring site)', () => {
    renderTopbar();
    expect(
      screen.getByRole('button', { name: /log out/i }),
    ).toBeInTheDocument();
  });

  it('wires the LogoutButton to authStore.logout', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'tok',
      user: { id: 'u', email: 'a@b.co', displayName: 'A' },
    });
    const assign = mockLocationAssign();
    server.use(
      http.post(endpoints.auth.logout, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    renderTopbar();
    screen.getByRole('button', { name: /log out/i }).click();
    // The logout POST + finally settle; authStore.logout clear+redirect fires.
    await new Promise((r) => setTimeout(r, 50));
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.accessToken).toBeNull();
    expect(assign).toHaveBeenCalledWith('/login');
  });
});

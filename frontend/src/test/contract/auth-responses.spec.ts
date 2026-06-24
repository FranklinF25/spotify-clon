import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { server } from '@/test/msw/server';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import type {
  AuthResponse,
  RefreshResponse,
  UserPrimitive,
} from '@/types/api';
import {
  authResponseAssertionSchema,
  refreshResponseAssertionSchema,
  userAssertionSchema,
} from './schemas';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useAuthStore.setState({ accessToken: null });
});
afterAll(() => server.close());

describe('contract: auth responses', () => {
  it('POST /auth/register returns { accessToken, user } (AuthResponse)', async () => {
    const body = await httpClient.post<AuthResponse>(
      endpoints.auth.register,
      { email: 'a@b.co', password: 'password1', displayName: 'Alice' },
      { skipAuthRefresh: true },
    );
    expect(authResponseAssertionSchema.safeParse(body).success).toBe(true);
  });

  it('POST /auth/login returns { accessToken, user } (AuthResponse)', async () => {
    const body = await httpClient.post<AuthResponse>(
      endpoints.auth.login,
      { email: 'a@b.co', password: 'password1' },
      { skipAuthRefresh: true },
    );
    const result = authResponseAssertionSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.accessToken).toBe('string');
      expect(result.data.user.id).toBeDefined();
    }
  });

  it('POST /auth/refresh returns { accessToken } ONLY — NO user (RefreshResponse)', async () => {
    const body = await httpClient.post<RefreshResponse>(
      endpoints.auth.refresh,
      {},
      { skipAuthRefresh: true },
    );
    const result = refreshResponseAssertionSchema.safeParse(body);
    expect(result.success).toBe(true);
    // Strict schema rejects the presence of a `user` field — AuthController
    // returns { accessToken } only (the boot flow hydrates user via /me).
    expect('user' in body).toBe(false);
  });

  it('GET /me returns the UserPrimitive projection', async () => {
    useAuthStore.setState({ accessToken: 'T' });
    const me = await httpClient.get<UserPrimitive>(endpoints.me);
    const result = userAssertionSchema.safeParse(me);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toContain('@');
      expect(result.data.displayName).toBeDefined();
    }
  });
});

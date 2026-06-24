import { describe, expect, it } from 'vitest';
import { registeredPaths } from '@/test/msw/handlers';

/**
 * REQ-FE-005 "Every slice-A endpoint has an MSW handler". Static assertion
 * over the handler registry — a missing handler would leave an endpoint
 * unmocked (MSW's onUnhandledRequest:'error' catches it at runtime too).
 */
const EXPECTED: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'POST', path: '/api/v1/auth/register' },
  { method: 'POST', path: '/api/v1/auth/login' },
  { method: 'POST', path: '/api/v1/auth/refresh' },
  { method: 'POST', path: '/api/v1/auth/logout' },
  { method: 'GET', path: '/api/v1/me' },
  { method: 'GET', path: '/api/v1/artists' },
  { method: 'GET', path: '/api/v1/artists/:id' },
  { method: 'GET', path: '/api/v1/albums' },
  { method: 'GET', path: '/api/v1/albums/:id' },
  { method: 'GET', path: '/api/v1/tracks/:id' },
  { method: 'GET', path: '/api/v1/search' },
  { method: 'GET', path: '/api/v1/tracks/:id/stream' },
];

describe('MSW handler coverage (REQ-FE-005)', () => {
  it('registers exactly the 12 slice-A endpoints', () => {
    expect(registeredPaths).toHaveLength(EXPECTED.length);
  });

  it.each(EXPECTED)(
    'registers $method $path',
    ({ method, path }) => {
      expect(registeredPaths).toContainEqual({ method, path });
    },
  );
});

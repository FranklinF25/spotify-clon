import { useAuthStore } from '@/store/auth.store';

/**
 * Reset client state between tests (DESIGN §10). Called from `setup.ts`
 * `afterEach` so specs start from a clean authStore + localStorage.
 *
 * Idempotent by design — safe to call before `usePlayerStore` exists (it
 * lands in PR-3). When the player store lands, its reset is added here.
 */
export function resetStores(): void {
  useAuthStore.setState({
    status: 'idle',
    user: null,
    accessToken: null,
    bootRefreshStarted: false,
  });
  // usePlayerStore reset lands with the store in PR-3 (FE-PR3-xx).
  // The httpOnly refresh cookie is backend-owned and never touches these stores.
  localStorage.clear();
  sessionStorage.clear();
}

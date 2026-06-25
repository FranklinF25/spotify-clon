import { useAuthStore } from '@/store/auth.store';
import { useToast } from '@/components/organisms/ToastHost/toast.store';
import { setBootRefreshGate } from '@/lib/api/http-client';

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
  // Toast store cleared so QueryCache/MutationCache onError tests don't leak
  // toasts into siblings (FE-PR2-01).
  useToast.setState({ toasts: [] });
  // Boot gate cleared so a refreshOnBoot run in one test does not park guarded
  // requests in a sibling (FE-PR2-02/03).
  setBootRefreshGate(null);
  localStorage.clear();
  sessionStorage.clear();
}

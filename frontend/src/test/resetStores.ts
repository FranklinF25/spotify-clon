import { useAuthStore } from '@/store/auth.store';
import { usePlayerStore } from '@/store/player.store';
import { useToast } from '@/components/organisms/ToastHost/toast.store';
import { setBootRefreshGate } from '@/lib/api/http-client';

/**
 * Reset client state between tests (DESIGN §10). Called from `setup.ts`
 * `afterEach` so specs start from a clean authStore + playerStore + localStorage.
 */
export function resetStores(): void {
  useAuthStore.setState({
    status: 'idle',
    user: null,
    accessToken: null,
    bootRefreshStarted: false,
  });
  usePlayerStore.setState({
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
  });
  // Toast store cleared so QueryCache/MutationCache onError tests don't leak
  // toasts into siblings (FE-PR2-01).
  useToast.setState({ toasts: [] });
  // Boot gate cleared so a refreshOnBoot run in one test does not park guarded
  // requests in a sibling (FE-PR2-02/03).
  setBootRefreshGate(null);
  localStorage.clear();
  sessionStorage.clear();
}

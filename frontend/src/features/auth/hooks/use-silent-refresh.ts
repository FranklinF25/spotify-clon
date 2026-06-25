import { useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';

/**
 * useSilentRefresh (DESIGN §5.3). Mounted ONCE at the root via `<Boot/>`
 * (providers.tsx), OUTSIDE `<RequireAuth>` and outside the router, so the boot
 * refresh runs regardless of the first route — a deep-link to `/login` still
 * triggers it. The store's `bootRefreshStarted` flag is the single-flight seam
 * that keeps it to one refresh even under React Strict Mode's dev double-invoke.
 */
export function useSilentRefresh(): void {
  const refreshOnBoot = useAuthStore((s) => s.refreshOnBoot);
  useEffect(() => {
    void refreshOnBoot();
  }, [refreshOnBoot]);
}

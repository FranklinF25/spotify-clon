import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query/queryClient';

/**
 * PR-1 minimal composition: `QueryClientProvider` ONLY.
 *
 * `<Boot/>` (which mounts `useSilentRefresh` once at the root, OUTSIDE the
 * router) is DEFERRED to FE-PR2-03 — it needs `authStore.refreshOnBoot` which
 * does not exist until PR-2. Do NOT add `<Boot/>` here in PR-1.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query/queryClient';
import { useSilentRefresh } from '@/features/auth/hooks/use-silent-refresh';

/**
 * `<Boot/>` — the SINGLE mount site for `useSilentRefresh` (DESIGN §5.3).
 * Renders nothing; exists only to run the boot refresh once at the root,
 * OUTSIDE the router (and therefore outside `<RequireAuth>`). Mounting the
 * hook inside `<RequireAuth>` would skip the refresh on the login page and
 * re-run it on every transition into the protected tree.
 *
 * Exported (not just internal) so its single-mount contract is unit-testable.
 */
export function Boot() {
  useSilentRefresh();
  return null;
}

/**
 * Root composition: `QueryClientProvider` + `<Boot/>` mounted once at the root.
 * `<RouterProvider/>` (with its guards) is passed as `children` by `main.tsx`,
 * so `<Boot/>` is a sibling of the router — never nested inside a route. This
 * keeps the silent refresh running for every initial route.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Boot />
      {children}
    </QueryClientProvider>
  );
}

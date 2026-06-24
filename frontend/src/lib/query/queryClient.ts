import { QueryClient } from '@tanstack/react-query';

/**
 * Minimal QueryClient for PR-1. PR-2 (FE-PR2-01) adds `QueryCache.onError` +
 * `MutationCache.onError` routing `ApiError`s to `useToast` — those handlers
 * need the toast store which does not exist yet, so they are deliberately
 * absent here.
 *
 * `retry: false` keeps the single-flight refresh path (http-client §6.1) as
 * the ONLY retry mechanism — letting TanStack also retry would double-fire
 * failed requests and mask the interceptor's single-retry contract.
 * `staleTime: 30_000` matches the catalog hooks (§5.1).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
    },
  },
});

import type { ReactElement } from 'react';
import { render as rtlRender } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface RenderOptions {
  /** MemoryRouter initial entries — deep-link a route for the test. */
  routeInitialEntries?: string[];
}

/**
 * Custom render: wraps `ui` in a FRESH `QueryClientProvider` (no cache leakage
 * between tests) + `MemoryRouter` (router context for guards/pages without
 * touching the real history). Exposes `queryClient` for cache assertions.
 *
 * Defaults `routeInitialEntries` to `['/']`. `useAuthStore`/`usePlayerStore`
 * are NOT wrapped here — they're module singletons reset by `resetStores`
 * between tests; wrapping them in a provider would break the "single mutation
 * point" contract (http-client mutates the module-scope store directly).
 */
export function render(
  ui: ReactElement,
  { routeInitialEntries = ['/'] }: RenderOptions = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    ...rtlRender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={routeInitialEntries}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

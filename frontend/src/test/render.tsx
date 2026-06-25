import type { ReactElement, ReactNode } from 'react';
import { render as rtlRender } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A MemoryRouter initial entry — either a path string or a partial location
 * (so a test can deep-link WITH router state, e.g. the RequireAuth `from`
 * redirect). Mirrors `history`'s `InitialEntry` without importing the
 * transitive `history` dep.
 */
type InitialEntry = string | { pathname: string; state?: unknown };

interface RenderOptions {
  /** MemoryRouter initial entries — deep-link a route (incl. state) for the test. */
  routeInitialEntries?: InitialEntry[];
}

/**
 * Custom render: wraps `ui` in a FRESH `QueryClientProvider` (no cache leakage
 * between tests) + `MemoryRouter` (router context for guards/pages without
 * touching the real history). Exposes `queryClient` for cache assertions.
 *
 * Uses rtlRender's `wrapper` option (NOT manual `<Provider>{ui}</Provider>`
 * composition) so that the returned `rerender` RE-RENDERS inside the same
 * wrapper — without it, rerender would drop the QueryClientProvider and hooks
 * like useAlbums would lose their client mid-test (the keepPreviousData spec
 * in FE-PR3-06 relies on this).
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
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={routeInitialEntries}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return {
    ...rtlRender(ui, { wrapper: Wrapper }),
    queryClient,
  };
}

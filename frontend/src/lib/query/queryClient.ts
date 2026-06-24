import {
  QueryCache,
  MutationCache,
  QueryClient,
} from '@tanstack/react-query';
import { ApiError } from '@/lib/api/http-client';
import { useToast } from '@/components/organisms/ToastHost/toast.store';

/**
 * Form-owned error codes — these are inlined by the form that issued the
 * request (DESIGN §9 third seam: form-level try/catch). The MutationCache
 * onError MUST NOT toast them, or a register/login VALIDATION_ERROR would be
 * double-routed (inline + toast). Queries never carry these, so QueryCache
 * routes everything; only the mutation cache filters.
 */
const FORM_OWNED_CODES = new Set(['VALIDATION_ERROR', 'CONFLICT']);

/**
 * Factory for the app QueryClient (DESIGN §9). Wiring BOTH cache `onError`
 * handlers here keeps the three error-routing seams in one auditable place:
 *
 *  - QueryCache.onError  → every `ApiError` from a query (catalog/search) is
 *    toasted. Queries are never form submissions.
 *  - MutationCache.onError → non-form mutations toast; form-owned codes
 *    (VALIDATION_ERROR/CONFLICT) are filtered so the owning form inlines them
 *    instead of producing a duplicate generic toast.
 *
 * Non-`ApiError` rejections (programming bugs) are NOT toasted — they stay in
 * the console. `retry: false` keeps the http-client single-flight refresh as
 * the ONLY retry mechanism (letting TanStack also retry would double-fire
 * failed requests and mask the interceptor's single-retry contract).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError) {
          useToast.getState().push({ code: error.code, message: error.message });
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (error instanceof ApiError && !FORM_OWNED_CODES.has(error.code)) {
          useToast.getState().push({ code: error.code, message: error.message });
        }
      },
    }),
  });
}

/**
 * App-wide singleton. Imported by `providers.tsx`. Component tests build their
 * own client via `createQueryClient()` (or a bare `new QueryClient`) so cache
 * state never leaks between tests.
 */
export const queryClient = createQueryClient();

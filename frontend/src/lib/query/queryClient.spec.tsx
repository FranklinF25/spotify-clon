import { describe, expect, it } from 'vitest';
import { useMutation, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { ApiError } from '@/lib/api/http-client';
import { createQueryClient } from './queryClient';
import { useToast } from '@/components/organisms/ToastHost/toast.store';

/**
 * FE-PR2-01 — QueryCache/MutationCache onError routing (DESIGN §9).
 *
 * Three error-routing seams:
 *  - QueryCache.onError  → toasts every ApiError from queries (catalog/search).
 *  - MutationCache.onError → toasts non-form ApiErrors; VALIDATION_ERROR +
 *    CONFLICT are form-owned (the form inlines them) and MUST NOT toast here.
 *  - form-level try/catch (exercised in LoginPage/RegisterPage specs).
 *
 * This spec owns the two cache-level seams. Non-ApiError rejections (programming
 * bugs) are NOT toasted — they stay in the console. Toast store is cleared
 * between tests by the global `resetStores` (setup.ts).
 */

describe('QueryCache.onError (queries route to toast)', () => {
  it('a query rejecting with ApiError(NOT_FOUND) pushes a toast with that code', async () => {
    const client = createQueryClient();
    await expect(
      client.fetchQuery({
        queryKey: ['x'],
        queryFn: () =>
          Promise.reject(new ApiError('NOT_FOUND', 'Album not found', 404)),
      }),
    ).rejects.toBeInstanceOf(ApiError);

    await waitFor(() => {
      expect(useToast.getState().toasts).toHaveLength(1);
    });
    expect(useToast.getState().toasts[0].code).toBe('NOT_FOUND');
    expect(useToast.getState().toasts[0].message).toBe('Album not found');
  });

  it('a non-ApiError rejection does NOT push a toast (programming bug stays in console)', async () => {
    const client = createQueryClient();
    await expect(
      client.fetchQuery({
        queryKey: ['bug'],
        queryFn: () => Promise.reject(new TypeError('boom')),
      }),
    ).rejects.toBeInstanceOf(TypeError);

    // Flush any (absent) handler microtasks.
    await new Promise((r) => setTimeout(r, 10));
    expect(useToast.getState().toasts).toHaveLength(0);
  });
});

describe('MutationCache.onError (form codes are exempt)', () => {
  /**
   * Drives a `useMutation` against `client` by mounting a probe inside its
   * QueryClientProvider. Returns the `mutateAsync` handle to fire in the test.
   */
  function mountMutation(
    client: ReturnType<typeof createQueryClient>,
    mutationFn: () => Promise<unknown>,
  ): () => Promise<unknown> {
    let mutateAsync!: () => Promise<unknown>;
    function Probe() {
      const m = useMutation({ mutationFn });
      // `useMutation` infers void variables; cast to the no-arg handle the
      // test drives (the mutationFn ignores its input).
      mutateAsync = m.mutateAsync as () => Promise<unknown>;
      return null;
    }
    render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Probe),
      ),
    );
    return mutateAsync;
  }

  it('a mutation rejecting with VALIDATION_ERROR does NOT push a toast (form owns it)', async () => {
    const client = createQueryClient();
    const mutate = mountMutation(client, () =>
      Promise.reject(
        new ApiError('VALIDATION_ERROR', 'bad', 400, [
          { field: 'email', issue: 'invalid' },
        ]),
      ),
    );
    await expect(mutate()).rejects.toBeInstanceOf(ApiError);
    await new Promise((r) => setTimeout(r, 10));
    expect(useToast.getState().toasts).toHaveLength(0);
  });

  it('a mutation rejecting with CONFLICT does NOT push a toast (form owns it)', async () => {
    const client = createQueryClient();
    const mutate = mountMutation(client, () =>
      Promise.reject(new ApiError('CONFLICT', 'email taken', 409)),
    );
    await expect(mutate()).rejects.toBeInstanceOf(ApiError);
    await new Promise((r) => setTimeout(r, 10));
    expect(useToast.getState().toasts).toHaveLength(0);
  });

  it('a non-form mutation rejecting with a non-form code DOES push a toast', async () => {
    const client = createQueryClient();
    const mutate = mountMutation(client, () =>
      Promise.reject(new ApiError('UNKNOWN', 'server died', 500)),
    );
    await expect(mutate()).rejects.toBeInstanceOf(ApiError);
    await waitFor(() => {
      expect(useToast.getState().toasts).toHaveLength(1);
    });
    expect(useToast.getState().toasts[0].code).toBe('UNKNOWN');
  });
});

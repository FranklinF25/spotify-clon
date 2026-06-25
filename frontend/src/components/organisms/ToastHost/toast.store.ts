import { create } from 'zustand';

/**
 * Toast store (DESIGN §9). The single sink for non-form `ApiError`s routed by
 * the QueryCache/MutationCache `onError` handlers (FE-PR2-01). Forms own their
 * own VALIDATION_ERROR/CONFLICT inline and never push here.
 *
 * `push` mints a `crypto.randomUUID()` id so `ToastHost` dismiss buttons can
 * target a stable key. No persistence — toasts are ephemeral.
 */
export interface Toast {
  id: string;
  code: string;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  push: (t) =>
    set((s) => ({
      toasts: [...s.toasts, { ...t, id: crypto.randomUUID() }],
    })),
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

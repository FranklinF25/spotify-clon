import { useToast } from './toast.store';
import styles from './ToastHost.module.css';

/**
 * ToastHost organism (DESIGN §9). Subscribes to `useToast` and renders an
 * `aria-live="polite"` region so non-form `ApiError`s (NOT_FOUND, generic 5xx,
 * non-form mutations) surface to assistive tech without stealing focus. Each
 * toast is a `role="status"` with a dismiss button.
 *
 * Not a form-error sink — VALIDATION_ERROR/CONFLICT are inlined by the form
 * that issued the request (DESIGN §9 third seam); this host never receives them.
 */
export function ToastHost() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  return (
    <div className={styles.region} aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} role="status">
          <span className={styles.message}>{t.message}</span>
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';
import styles from './SaveToLibraryButton.module.css';

/**
 * SaveToLibraryButton molecule (REQ-FE-017; DESIGN §9.5). Presentational:
 * the page owns hooks + error state, the molecule owns rendering.
 *
 * Icon: the existing `library` icon (verified IconName union — no heart
 * icon exists, none is invented). `aria-pressed` exposes the toggle state
 * to assistive tech; `role="alert"` surfaces a failed save/remove inline
 * on the control (D-fe-1 — the page sets `error`, this renders it).
 */
interface SaveToLibraryButtonProps {
  isSaved: boolean;
  /** Disabled while the library cache boots — the saved state is unknown. */
  disabled: boolean;
  /** True while either mutation is in flight. */
  isPending: boolean;
  error: string | null;
  onToggle: () => void;
}

export function SaveToLibraryButton({
  isSaved,
  disabled,
  isPending,
  error,
  onToggle,
}: SaveToLibraryButtonProps) {
  return (
    <div className={styles.wrap}>
      <Button
        variant={isSaved ? 'secondary' : 'primary'}
        aria-pressed={isSaved}
        aria-label={isSaved ? 'Remove from library' : 'Save to library'}
        disabled={disabled || isPending}
        onClick={onToggle}
      >
        <Icon name="library" size={18} aria-hidden="true" />
        {isSaved ? 'Remove from library' : 'Save to library'}
      </Button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

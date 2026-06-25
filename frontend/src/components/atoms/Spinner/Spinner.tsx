import styles from './Spinner.module.css';

/**
 * Spinner atom (DESIGN §7, §11.1). Pure presentational loading indicator.
 *
 * a11y: `role="status"` + `aria-label="Loading"` so assistive tech announces
 * a pending query. Used by HomePage loading state (FE-PR3-12). Owns no state,
 * composes nothing.
 */
export function Spinner({
  'aria-label': label = 'Loading',
}: {
  'aria-label'?: string;
}) {
  return (
    <span
      className={styles.spinner}
      role="status"
      aria-label={label}
      data-spinning="true"
    >
      <span className={styles.ring} aria-hidden="true" />
    </span>
  );
}

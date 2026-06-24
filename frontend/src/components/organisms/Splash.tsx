import styles from './Splash.module.css';

/**
 * Splash organism (DESIGN §8). Full-viewport loading state shown by the route
 * guards during the boot-refresh window (`<RequireAuth>` on idle/authenticating
 * or `authenticated && user===null`; `<RedirectIfAuthed>` on idle/authenticating).
 *
 * Single shared instance — NOT duplicated per guard. `role="status"` +
 * `aria-label` so assistive tech announces the loading state.
 */
export function Splash() {
  return (
    <div className={styles.splash} role="status" aria-label="Loading">
      <span className={styles.spinner} aria-hidden="true" />
    </div>
  );
}

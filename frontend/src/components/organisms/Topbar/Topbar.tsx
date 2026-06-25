import { LogoutButton } from '@/components/molecules/LogoutButton/LogoutButton';
import { useAuthStore } from '@/store/auth.store';
import styles from './Topbar.module.css';

/**
 * Topbar organism (DESIGN §7, §11.1). The protected top chrome.
 *
 * This is the WIRING SITE promised in FE-PR2-11: LogoutButton is presentational
 * (takes `onLogout`, can't import store — §3 rule); Topbar connects it to
 * `authStore.logout` here. Organisms may read store (only atoms/molecules are
 * forbidden), so this is the correct seam.
 */
export function Topbar() {
  // Select `logout` off the store so the molecule stays presentation-thin.
  const logout = useAuthStore((s) => s.logout);
  return (
    <header className={styles.topbar} role="banner">
      <div className={styles.spacer} aria-hidden="true" />
      <LogoutButton onLogout={logout} />
    </header>
  );
}

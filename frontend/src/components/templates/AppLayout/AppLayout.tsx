import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/organisms/Sidebar/Sidebar';
import { Topbar } from '@/components/organisms/Topbar/Topbar';
import styles from './AppLayout.module.css';

/**
 * AppLayout template (REQ-FE-008, DESIGN §8, §11.1). The PROTECTED shell.
 *
 * Mounts the four Spotify-like chrome landmarks:
 *  - `<nav>`     Sidebar (Home / Search + disabled Playlists/Library stubs)
 *  - `<header>`  Topbar  (LogoutButton wiring)
 *  - `<main>`    the routed page (`<Outlet/>`)
 *  - `<footer role="region" aria-label="Player">`  the PlayerBarSlot
 *
 * The player region hosts `<PlayerBarSlot/>` — an EMPTY placeholder. The real
 * `<PlayerBar/>` (audio sync seam + blob lifecycle) lands in FE-PR4-04;
 * reserving the slot here keeps PR-3 independently coherent (chrome landmarks
 * are verifiable without a no-op PlayerBar stub split across two PRs).
 *
 * React Router keeps this layout element mounted across `/` ↔ `/albums/:id` ↔
 * `/artists/:id` transitions (REQ-FE-008 "PlayerBar mounted exactly once"
 * depends on this in PR-4).
 */
export function AppLayout() {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <Sidebar />
      </aside>
      <Topbar />
      <main className={styles.content}>
        <Outlet />
      </main>
      <footer className={styles.player} role="region" aria-label="Player">
        <PlayerBarSlot />
      </footer>
    </div>
  );
}

/**
 * Empty placeholder for the global player. Renders nothing in PR-3; FE-PR4-04
 * swaps this for the real `<PlayerBar/>` organism. Keeping it as a named
 * component makes the swap site explicit + the footer region always present.
 */
function PlayerBarSlot() {
  return null;
}

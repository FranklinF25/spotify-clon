import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/organisms/Sidebar/Sidebar';
import { Topbar } from '@/components/organisms/Topbar/Topbar';
import { PlayerBar } from '@/components/organisms/PlayerBar/PlayerBar';
import styles from './AppLayout.module.css';

/**
 * AppLayout template (REQ-FE-008, DESIGN §8, §11.1). The PROTECTED shell.
 *
 * Mounts the four Spotify-like chrome landmarks:
 *  - `<nav>`     Sidebar (Home / Search + disabled Playlists/Library stubs)
 *  - `<header>`  Topbar  (LogoutButton wiring)
 *  - `<main>`    the routed page (`<Outlet/>`)
 *  - `<footer>`  hosts the global PlayerBar (the PlayerBar organism itself
 *                owns `role="region" aria-label="Player"` per DESIGN §11.1;
 *                the footer is just the layout container — the region role
 *                is asserted in PlayerBar.spec + visible to assistive tech
 *                because PlayerBar renders inside the footer).
 *
 * FE-PR4-04 swaps the PR-3 `<PlayerBarSlot/>` placeholder for the real
 * `<PlayerBar/>` organism (audio sync seam + blob lifecycle, FE-PR4-02).
 * The runtime single-mount invariant (REQ-FE-008 "PlayerBar is mounted
 * exactly once in AppLayout") is enforced by architecture.spec.ts Part 2:
 * it renders this layout, navigates between `/home`, `/albums/:id`,
 * `/artists/:id`, and asserts the `<audio>` element identity is STABLE.
 *
 * React Router keeps this layout element mounted across /home ↔ /albums/:id
 * ↔ /artists/:id transitions because the entire protected route table is
 * nested under one AppLayout element.
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
      <footer className={styles.player}>
        <PlayerBar />
      </footer>
    </div>
  );
}

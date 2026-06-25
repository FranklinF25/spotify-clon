import type { ReactNode } from 'react';
import styles from './AuthLayout.module.css';

/**
 * AuthLayout template (REQ-FE-008). The PUBLIC shell — a centered `<main>`
 * landmark hosting the auth form (login/register). Deliberately NO Sidebar,
 * Topbar, or PlayerBar (those belong to AppLayout, the protected shell, which
 * lands in PR-3). CSS Module centers the card.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return <main className={styles.layout}>{children}</main>;
}

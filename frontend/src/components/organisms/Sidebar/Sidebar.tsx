import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '@/components/atoms/Icon/Icon';
import styles from './Sidebar.module.css';

/**
 * Sidebar organism (REQ-FE-013 — TERMINAL state, F6).
 *
 * Every navigation entry is a REAL `NavLink`: Home + Search + Playlists
 * (F5) and Library (F6 — the last stub graduated now that the full library
 * vertical exists: backend + /library unified page + album save affordance).
 * Zero "coming soon" placeholders remain; the stub machinery is deleted
 * outright (a structural fact, not an empty loop).
 */
interface NavItem {
  kind: 'link';
  to: string;
  label: string;
  icon: IconName;
}

const PRIMARY: NavItem[] = [
  { kind: 'link', to: '/', label: 'Home', icon: 'home' },
  { kind: 'link', to: '/search', label: 'Search', icon: 'search' },
  { kind: 'link', to: '/playlists', label: 'Playlists', icon: 'playlist' },
  { kind: 'link', to: '/library', label: 'Library', icon: 'library' },
];

export function Sidebar() {
  return (
    <nav className={styles.sidebar} aria-label="Main navigation">
      <ul className={styles.list}>
        {PRIMARY.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={styles.link}
              end={item.to === '/'}
            >
              <Icon name={item.icon} size={22} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

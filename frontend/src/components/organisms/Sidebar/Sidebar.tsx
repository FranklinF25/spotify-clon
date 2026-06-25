import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '@/components/atoms/Icon/Icon';
import styles from './Sidebar.module.css';

/**
 * Sidebar organism (REQ-FE-013, DESIGN §7).
 *
 * The protected navigation rail: Home + Search are REAL `NavLink`s (their
 * backend contexts exist in Slice A). Playlists + Library are HONEST disabled
 * placeholders — `<button disabled aria-disabled="true">` labelled "Coming
 * soon" — because their backend contexts are `.gitkeep`-only (Slice A scope).
 * No dead `<a href>` links, no fake features (REQ-FE-013).
 */
interface NavItem {
  kind: 'link';
  to: string;
  label: string;
  icon: IconName;
}
interface StubItem {
  kind: 'stub';
  label: string;
  icon: IconName;
}

const PRIMARY: NavItem[] = [
  { kind: 'link', to: '/', label: 'Home', icon: 'home' },
  { kind: 'link', to: '/search', label: 'Search', icon: 'search' },
];

// F5 (Playlists) + F6 (Library) backend contexts are absent in Slice A.
// These are honest placeholders, not fake links (REQ-FE-013, CO-frontend-6).
const STUBS: StubItem[] = [
  { kind: 'stub', label: 'Playlists', icon: 'playlist' },
  { kind: 'stub', label: 'Library', icon: 'library' },
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

      <div className={styles.sectionDivider} />

      <ul className={styles.list}>
        {STUBS.map((item) => (
          <li key={item.label}>
            {/*
              Disabled placeholder, NOT a link: the backend context does not
              exist yet (REQ-FE-013). aria-disabled + disabled so it's clearly
              non-operative to both AT + pointer/keyboard users.
            */}
            <button
              type="button"
              className={styles.stub}
              disabled
              aria-disabled="true"
              aria-label={item.label}
            >
              <Icon name={item.icon} size={22} aria-hidden="true" />
              <span>{item.label}</span>
              <span className={styles.badge}>Coming soon</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

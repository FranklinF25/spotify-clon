import type { SVGProps } from 'react';
import styles from './Icon.module.css';

/**
 * Icon atom (DESIGN §7, §11.1). Pure presentational inline SVG.
 *
 * a11y contract (the portfolio payload — strict-tdd bans class assertions, so
 * the accessible-name behaviour IS the contract):
 *  - pass `aria-label` → the svg is `role="img"` + announced by screen readers;
 *  - omit `aria-label` → the svg is `aria-hidden` so a decorative icon next to
 *    a text label does not get double-announced.
 *
 * Composes nothing; owns no state. The path registry is inline so the seam
 * stays legible (no icon-font / external sprite dependency).
 */

export type IconName =
  | 'home'
  | 'search'
  | 'play'
  | 'pause'
  | 'next'
  | 'prev'
  | 'playlist'
  | 'library';

const PATHS: Record<IconName, string> = {
  home: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10',
  search:
    'M11 4a7 7 0 100 14 7 7 0 000-14zm10 17l-5.5-5.5',
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  next: 'M6 5l9 7-9 7V5zm10 0h3v14h-3z',
  prev: 'M18 5l-9 7 9 7V5zM5 5h3v14H5z',
  playlist: 'M3 5h13v2H3zM3 9h13v2H3zM3 13h9v2H3zM14 13v6M14 19a1.5 1.5 0 10-.001 0z',
  library: 'M4 4v16M8 4v16M12 4v16M16 4v16',
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Size in px — defaults to 24 (matches `<button>` touch target rhythm). */
  size?: number;
}

export function Icon({ name, size = 24, ...rest }: IconProps) {
  const labelled = rest['aria-label'] !== undefined;
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : 'true'}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

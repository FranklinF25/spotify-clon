import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

/**
 * Button atom (DESIGN §7). Presentational only — composes nothing, owns no
 * domain state. The full atom set (Icon/Spinner) lands in PR-3; PR-2 needs
 * Button for form submit + LogoutButton, so the minimal contract lives here.
 *
 * Variants: `primary` (accent, auth forms), `secondary` (LogoutButton, neutral),
 * `ghost` (transparent — AlbumCard/TrackRow play buttons, FE-PR3-02/03).
 */
type Variant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={className ? `${styles.button} ${styles[variant]} ${className}` : `${styles.button} ${styles[variant]}`}
      {...rest}
    />
  );
}

import type { InputHTMLAttributes } from 'react';
import styles from './Input.module.css';

/**
 * Input atom (DESIGN §7). Thin passthrough over `<input>` so `FormField`
 * (FE-PR2-06) can wire `aria-invalid`/`aria-describedby` against a stable
 * presentational seam. Presentational only — owns no domain state.
 */
export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={className ? `${styles.input} ${className}` : styles.input}
      {...rest}
    />
  );
}

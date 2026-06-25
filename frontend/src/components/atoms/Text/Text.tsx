import type { ElementType, ReactNode } from 'react';
import styles from './Text.module.css';

/**
 * Text atom (DESIGN §7). Polymorphic presentational text element. `FormField`
 * (FE-PR2-06) renders the inline zod-issue message through this with
 * `variant="error"`. Owns no domain state.
 */
type Variant = 'body' | 'error' | 'muted';

interface TextProps {
  as?: ElementType;
  variant?: Variant;
  children: ReactNode;
  id?: string;
  htmlFor?: string;
}

export function Text({
  as: Tag = 'span',
  variant = 'body',
  children,
  ...rest
}: TextProps) {
  return (
    <Tag className={styles[variant]} {...rest}>
      {children}
    </Tag>
  );
}

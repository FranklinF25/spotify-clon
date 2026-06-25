import type { ButtonHTMLAttributes } from 'react';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';

/**
 * PrevButton (DESIGN §6.2 transport molecule). Pure presentational — the
 * transport logic lives in playerStore (`prev` walks the queue -1, clamps
 * at 0). aria-label "Previous" so screen readers announce it.
 */
export type PrevButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function PrevButton(props: PrevButtonProps) {
  return (
    <Button variant="ghost" aria-label="Previous" {...props}>
      <Icon name="prev" size={20} aria-hidden="true" />
    </Button>
  );
}

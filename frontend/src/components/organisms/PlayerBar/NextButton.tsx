import type { ButtonHTMLAttributes } from 'react';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';

/**
 * NextButton (DESIGN §6.2 transport molecule). Pure presentational — the
 * transport logic lives in playerStore (`next` walks the queue +1 and
 * STOPS at end with isPlaying:false, no wrap — REQ-FE-011).
 */
export type NextButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function NextButton(props: NextButtonProps) {
  return (
    <Button variant="ghost" aria-label="Next" {...props}>
      <Icon name="next" size={20} aria-hidden="true" />
    </Button>
  );
}

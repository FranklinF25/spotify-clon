import type { ButtonHTMLAttributes } from 'react';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';

/**
 * PlayPauseButton (DESIGN §6.2 transport molecule). Pure presentational —
 * aria-label flips between "Play" and "Pause" based on `isPlaying` so the
 * button's accessible name reflects the ACTION pressing it will perform
 * (matching native media controls). The icon mirrors the same state.
 */
interface PlayPauseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isPlaying: boolean;
}

export function PlayPauseButton({ isPlaying, ...rest }: PlayPauseButtonProps) {
  return (
    <Button
      variant="ghost"
      aria-label={isPlaying ? 'Pause' : 'Play'}
      {...rest}
    >
      <Icon name={isPlaying ? 'pause' : 'play'} size={20} aria-hidden="true" />
    </Button>
  );
}

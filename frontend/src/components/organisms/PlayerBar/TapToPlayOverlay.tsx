import type { ButtonHTMLAttributes } from 'react';
import { Button } from '@/components/atoms/Button/Button';

/**
 * TapToPlayOverlay (DESIGN §6.2, JD fix #14). Surfaced when el.play()
 * rejects (browser autoplay policy / not-allowed). The user gesture of
 * clicking this button unblocks playback; PlayerBar wires the click to
 * clear `playBlocked` + retry `togglePlay()`. A real visible affordance
 * instead of a silently stuck play button (regression the JD fix closed).
 */
export type TapToPlayOverlayProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function TapToPlayOverlay(props: TapToPlayOverlayProps) {
  return (
    <Button variant="primary" aria-label="Tap to play" {...props}>
      Tap to play
    </Button>
  );
}

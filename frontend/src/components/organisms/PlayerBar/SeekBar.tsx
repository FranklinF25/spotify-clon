import styles from './PlayerBar.module.css';

/**
 * SeekBar (DESIGN §6.2 transport molecule) — a labelled `<input type="range">`
 * bound to `currentTime` / `duration`. The drag is split into:
 *  - onInput  → local visual position (no store write — keeps the drag smooth)
 *  - onChange → commit (write setCurrentTime + setIsUserSeeking + clear scrubbing)
 *  - onPointerDown / onPointerUp → toggle the scrubbing flag so onTimeUpdate
 *    no-ops while the user drags.
 *
 * a11y (DESIGN §11.1): role="slider" (implicit from type=range), aria-label
 * "Seek", plus aria-valuenow / aria-valuemax mirroring the input's value/max.
 */
interface SeekBarProps {
  value: number;
  max: number;
  onInput: (v: number) => void;
  onChange: (v: number) => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
}

export function SeekBar({
  value,
  max,
  onInput,
  onChange,
  onPointerDown,
  onPointerUp,
}: SeekBarProps) {
  return (
    <input
      className={`${styles.slider} ${styles.seek}`}
      type="range"
      role="slider"
      aria-label="Seek"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      min={0}
      max={max}
      step={0.1}
      value={value}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onInput={(e) => onInput(Number(e.currentTarget.value))}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    />
  );
}

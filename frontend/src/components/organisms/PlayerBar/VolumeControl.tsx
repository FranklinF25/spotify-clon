import styles from './PlayerBar.module.css';

/**
 * VolumeControl (DESIGN §6.2 transport molecule) — a labelled
 * `<input type="range">` bound to `volume` (clamped [0,1] upstream in the
 * store). Commits call `setVolume(v)`; the store's clamp guarantees the
 * value stays in range. aria-label "Volume" + aria-valuenow for SR users.
 */
interface VolumeControlProps {
  value: number;
  onChange: (v: number) => void;
}

export function VolumeControl({ value, onChange }: VolumeControlProps) {
  return (
    <input
      className={`${styles.slider} ${styles.volume}`}
      type="range"
      aria-label="Volume"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={1}
      min={0}
      max={1}
      step={0.01}
      value={value}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    />
  );
}

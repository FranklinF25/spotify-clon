import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';
import styles from './SearchBar.module.css';

/**
 * SearchBar molecule (REQ-FE-010, DESIGN §11.1). Presentational: a labelled
 * `<form>` with `<input type="search">` + a submit button. Emits `onSubmit(q)`
 * upward — the container page navigates to /search?q=... Reads NO store
 * (architecture rule).
 *
 * Keyboard-operable because it's a real `<form>`: pressing Enter submits
 * natively (the submit handler is the single source of truth; jsdom does not
 * emulate implicit form submission on Enter, so the spec drives submit()
 * directly — the real browser path is the same handler).
 */
interface SearchBarProps {
  onSubmit: (q: string) => void;
  /** Pre-fill (the SearchPage reads ?q= from the URL + seeds this). */
  initialValue?: string;
  /** Accessible label; defaults to "Search". */
  label?: string;
}

export function SearchBar({ onSubmit, initialValue = '', label = 'Search' }: SearchBarProps) {
  const [value, setValue] = useState(initialValue);
  const id = useId();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // the page owns navigation, not the form
    onSubmit(value.trim());
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} role="search">
      <span className={styles.iconWrap} aria-hidden="true">
        <Icon name="search" size={18} />
      </span>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type="search"
        className={styles.input}
        value={value}
        placeholder="Songs, artists, albums"
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" variant="ghost" aria-label="Go">
        <Icon name="search" size={16} aria-hidden="true" />
      </Button>
    </form>
  );
}

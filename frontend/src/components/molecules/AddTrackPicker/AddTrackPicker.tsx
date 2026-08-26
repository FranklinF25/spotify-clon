import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/http-client';
import { formatDuration } from '@/lib/format/duration';
import type { TrackSummary } from '@/types/api';
import { Input } from '@/components/atoms/Input/Input';
import { Button } from '@/components/atoms/Button/Button';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import styles from './AddTrackPicker.module.css';

/**
 * Debounce window (ms) between the last keystroke and the onSearch call.
 * 300ms is the classic "still typing" grace period — fast enough to feel
 * live, slow enough that "hello" is ONE search, not six.
 */
const DEBOUNCE_MS = 300;

/**
 * AddTrackPicker molecule (REQ-FE-015 UX fix, DESIGN §7). Replaces the old
 * AddTrackForm ("paste a track UUID" — nobody knows UUIDs) with the Spotify
 * model: type a query → debounced search → click a result → it is added.
 *
 * PRESENTATIONAL + LOCAL UI STATE ONLY (atomic-design §3: molecules import
 * `lib/` + `atoms/` only — NEVER `features/`/`store/`/`pages/`, so this file
 * cannot call `useSearch` directly). Data arrives through two injected
 * seams, exactly like AddTrackForm's `onSubmit` before it:
 *  - `onSearch(q)` → track results (the parent adapts the search feature),
 *  - `onAdd(trackId)` → the parent's useAddTrack mutation.
 *
 * The molecule owns: the query input, the cancellable ~300ms debounce, the
 * results list (title + duration — TrackSummary carries NO artist field;
 * rendering one would invent data the API does not return), the explicit
 * no-results state, and honest error surfacing with the SAME ApiError.code
 * → message mapping AddTrackForm had:
 *  - 422 UNPROCESSABLE_ENTITY (track vanished between search and add)
 *    → "track not found"
 *  - 403 FORBIDDEN (non-owner) → "you are not the owner of this playlist"
 *  - other ApiError → e.message; non-ApiError → "could not add track"
 * A rejected onSearch surfaces "could not search" (distinct from add
 * failures — the user must know WHICH step failed).
 */
interface AddTrackPickerProps {
  /** Search seam owned by the parent (adapts useSearch / the search feature). */
  onSearch: (q: string) => Promise<TrackSummary[]> | TrackSummary[];
  /** Add seam owned by the parent (wires the useAddTrack mutation). */
  onAdd: (trackId: string) => Promise<unknown>;
  /** Pending flag from the parent's mutation (disables every Add button). */
  isAddPending?: boolean;
}

export function AddTrackPicker({
  onSearch,
  onAdd,
  isAddPending = false,
}: AddTrackPickerProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<TrackSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The trackId whose add is CURRENTLY in flight (per-row pending state).
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);

  // Debounce — CANCELLED on every keystroke and on unmount (the cleanup
  // clears the pending timeout, so a stale query never fires a search).
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  // Search — runs only for a NON-empty debounced query. The `cancelled`
  // flag discards resolutions that arrive after the query moved on (a slow
  // "xy" response must NOT overwrite the fresh "xyz" results).
  useEffect(() => {
    if (debouncedQuery.length === 0) {
      setResults(null);
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setError(null);
    setIsSearching(true);
    // Promise.resolve normalizes the sync-array | promise union of onSearch.
    Promise.resolve(onSearch(debouncedQuery))
      .then((found) => {
        if (cancelled) return;
        setResults(found);
        setIsSearching(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('could not search');
        setIsSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, onSearch]);

  // Add — same ApiError.code → message contract as the deleted AddTrackForm
  // (kept verbatim so the page spec's honesty assertions survive the swap).
  const handleAdd = async (trackId: string) => {
    setError(null);
    setPendingTrackId(trackId);
    try {
      await onAdd(trackId);
      // Success: the parent's useAddTrack.onSuccess invalidation refetches
      // the track list; the results stay so more tracks can be added.
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'UNPROCESSABLE_ENTITY') {
          setError('track not found');
        } else if (e.code === 'FORBIDDEN') {
          setError('you are not the owner of this playlist');
        } else {
          setError(e.message);
        }
      } else {
        setError('could not add track');
      }
    } finally {
      setPendingTrackId(null);
    }
  };

  // One add at a time: the parent's mutation is single-flight, so ANY
  // in-flight add (row-local or the parent's isAddPending) locks every row.
  const addLocked = isAddPending || pendingTrackId !== null;

  return (
    <section className={styles.picker} aria-label="Add tracks">
      <label className={styles.label} htmlFor="add-track-search">
        Search tracks
      </label>
      <Input
        id="add-track-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tracks to add"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'add-track-error' : undefined}
      />
      {isSearching && <Spinner aria-label="Searching tracks" />}
      {error && (
        <p id="add-track-error" className={styles.error} role="alert">
          {error}
        </p>
      )}
      {results !== null && results.length === 0 && !isSearching && (
        <p className={styles.empty}>No tracks found.</p>
      )}
      {results !== null && results.length > 0 && (
        <ul className={styles.results} aria-label="Track results">
          {results.map((track) => (
            <li key={track.id} className={styles.result}>
              <span className={styles.title}>{track.title}</span>
              <span className={styles.duration}>
                {formatDuration(track.durationSeconds)}
              </span>
              <Button
                variant="primary"
                aria-label={`Add ${track.title}`}
                className={styles.add}
                disabled={addLocked}
                onClick={() => void handleAdd(track.id)}
              >
                {pendingTrackId === track.id ? 'Adding…' : 'Add'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

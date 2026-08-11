import { useState } from 'react';
import { z } from 'zod';
import { ApiError } from '@/lib/api/http-client';
import { Input } from '@/components/atoms/Input/Input';
import { Button } from '@/components/atoms/Button/Button';
import styles from './AddTrackForm.module.css';

/**
 * addTrackSchema — zod mirror of the minimal client gate. The only honest
 * client-side check is "non-empty trackId" (the backend owns the 422 unknown-
 * track validation). Validating PRE-request means an empty submit never calls
 * onSubmit (so no POST /playlists/:id/tracks is issued).
 */
const addTrackSchema = z.object({
  trackId: z.string().min(1, 'track id is required'),
});

/**
 * AddTrackForm molecule (REQ-FE-015, DESIGN §7). PRESENTATIONAL — owns the
 * zod gate + honest error surfacing, but delegates the mutation to the parent
 * page via `onSubmit`. This keeps the molecule free of `features/` imports
 * (atomic-design §3 dependency rule: molecules never import hooks/store/pages;
 * `lib/` + `atoms/` only). The parent wires `useAddTrack` and passes the
 * handler + pending flag.
 *
 * Honest error surfacing (the thrown ApiError.code drives the message):
 *  - 422 UNPROCESSABLE_ENTITY (unknown trackId) → "track not found"
 *  - 403 FORBIDDEN (non-owner) → "you are not the owner"
 *  - success → input resets (the parent's tracks-query invalidation, fired
 *    inside `useAddTrack.onSuccess`, appends the track on refetch).
 */
interface AddTrackFormProps {
  /** Submit handler owned by the parent (wires the useAddTrack mutation). */
  onSubmit: (trackId: string) => Promise<unknown>;
  /** Pending flag from the parent's mutation (disables the submit button). */
  isPending?: boolean;
}

export function AddTrackForm({ onSubmit, isPending }: AddTrackFormProps) {
  const [trackId, setTrackId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = addTrackSchema.safeParse({ trackId });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'invalid');
      return;
    }
    setError(null);
    try {
      await onSubmit(parsed.data.trackId);
      setTrackId('');
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
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <label className={styles.label} htmlFor="add-track-id">
        Track id
      </label>
      <Input
        id="add-track-id"
        value={trackId}
        onChange={(e) => setTrackId(e.target.value)}
        placeholder="e.g. track-uuid"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'add-track-error' : undefined}
      />
      {error && (
        <p id="add-track-error" className={styles.error} role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={isPending}>
        Add track
      </Button>
    </form>
  );
}

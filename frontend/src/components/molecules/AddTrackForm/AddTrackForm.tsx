import { useState } from 'react';
import { z } from 'zod';
import { useAddTrack } from '@/features/playlists/hooks/use-add-track';
import { ApiError } from '@/lib/api/http-client';
import { Input } from '@/components/atoms/Input/Input';
import { Button } from '@/components/atoms/Button/Button';
import styles from './AddTrackForm.module.css';

/**
 * addTrackSchema — zod mirror of the minimal client gate. The only honest
 * client-side check is "non-empty trackId" (the backend owns the 422 unknown-
 * track validation). Validating PRE-request means an empty submit never issues
 * a POST /playlists/:id/tracks.
 */
const addTrackSchema = z.object({
  trackId: z.string().min(1, 'track id is required'),
});

/**
 * AddTrackForm molecule (REQ-FE-015, DESIGN §7).
 *
 * Track picker for the demo: a simple trackId input → `useAddTrack` mutation.
 * Honest error surfacing:
 *  - 422 UNPROCESSABLE_ENTITY (unknown trackId) → "track not found"
 *  - 403 FORBIDDEN (non-owner) → "you are not the owner"
 *  - 201 success → input resets; `useAddTrack.onSuccess` invalidates the
 *    tracks query, so the parent list refetches and the new track appears.
 */
interface AddTrackFormProps {
  playlistId: string;
}

export function AddTrackForm({ playlistId }: AddTrackFormProps) {
  const addTrack = useAddTrack();
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
      await addTrack.mutateAsync({ id: playlistId, trackId: parsed.data.trackId });
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
      <Button type="submit" variant="primary" disabled={addTrack.isPending}>
        Add track
      </Button>
    </form>
  );
}

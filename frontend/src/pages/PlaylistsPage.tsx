import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { usePlaylists } from '@/features/playlists/hooks/use-playlists';
import { useCreatePlaylist } from '@/features/playlists/hooks/use-create-playlist';
import { PlaylistGrid } from '@/components/organisms/PlaylistGrid/PlaylistGrid';
import { Spinner } from '@/components/atoms/Spinner/Spinner';
import { Button } from '@/components/atoms/Button/Button';
import { Input } from '@/components/atoms/Input/Input';
import styles from './PlaylistsPage.module.css';

/**
 * createPlaylistSchema — zod mirror of the backend CreatePlaylistDto (title
 * 1–100 chars). Validating PRE-request means an invalid title never issues a
 * POST /playlists (REQ-FE-014 scenario "Invalid title is blocked before the
 * request is sent").
 */
const createPlaylistSchema = z.object({
  title: z
    .string()
    .min(1, 'title is required')
    .max(100, 'title must be at most 100 characters'),
});

type FormErrors = Partial<Record<'title', string>>;

/**
 * PlaylistsPage (REQ-FE-014). Lists the current user's playlists + offers a
 * create-new entry point. The list is sourced from `['playlists','list']`
 * (owner-scoped server-side). On create success the list is invalidated and
 * the SPA navigates to /playlists/:id for the newly-created playlist.
 *
 * Honest states: loading (Spinner), empty ("no playlists yet" + the create
 * CTA), error (inline message — QueryCache.onError also toasts).
 */
export function PlaylistsPage() {
  const { data, isLoading, isError } = usePlaylists();
  const create = useCreatePlaylist();
  const navigate = useNavigate();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  if (isLoading) {
    return (
      <section className={styles.page}>
        <Spinner aria-label="Loading playlists" />
      </section>
    );
  }

  if (isError) {
    return (
      <section className={styles.page}>
        <p className={styles.error}>Couldn't load playlists.</p>
        <Button variant="secondary" onClick={() => location.reload()}>
          Try again
        </Button>
      </section>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = createPlaylistSchema.safeParse({ title });
    if (!parsed.success) {
      const fieldErrors: FormErrors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'title') fieldErrors.title = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    try {
      const created = await create.mutateAsync({ title: parsed.data.title });
      navigate(`/playlists/${created.id}`);
    } catch {
      // ApiError surfaces via MutationCache.onError toast; keep the form open.
    }
  };

  const playlists = data ?? [];

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Playlists</h1>
        {!showForm && (
          <Button variant="primary" onClick={() => setShowForm(true)}>
            New playlist
          </Button>
        )}
      </header>

      {showForm && (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <label className={styles.fieldLabel} htmlFor="playlist-title">
            Title
          </label>
          <Input
            id="playlist-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? 'playlist-title-error' : undefined}
          />
          {errors.title && (
            <p id="playlist-title-error" className={styles.fieldError} role="alert">
              {errors.title}
            </p>
          )}
          <div className={styles.formActions}>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Create
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setTitle('');
                setErrors({});
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {playlists.length === 0 ? (
        !showForm && <p className={styles.empty}>No playlists yet</p>
      ) : (
        <PlaylistGrid playlists={playlists} />
      )}
    </section>
  );
}

import {
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { Button } from '@/components/atoms/Button/Button';
import { Icon } from '@/components/atoms/Icon/Icon';
import { useUploadTrack } from '@/features/upload/hooks/use-upload-track';
import { ApiError } from '@/lib/api/http-client';
import type { UploadResult } from '@/types/api';
import styles from './UploadPage.module.css';

/**
 * UploadPage (REQ-UPLOAD-002) — the authenticated multi-file upload surface.
 *
 * ARCHITECTURE (documented choice, mirrors the use-upload-track header):
 * a page-level `useReducer` owns the row list — one row per picked file with
 * its own progress/status — while the raw transfer lives in
 * `httpClient.uploadFile` (XHR, progress) and the cache side effect lives in
 * `useUploadTrack` (TanStack invalidation on success). TanStack Query stays
 * out of the transfer itself; a mutation cannot host N parallel per-file
 * progress streams without re-implementing this very reducer.
 *
 * DropZone is INLINE in the page (deliberate): a single consumer today, and
 * a molecule extraction would have to decide now — wrongly — whether
 * "accepted extensions" and "max size" are props or config. When a second
 * consumer appears, lift `<DropZone onFiles={...} accept={...}>` verbatim.
 *
 * Client-side pre-validation (extension allowlist + ≤150MB) mirrors the
 * backend guards so a doomed pick fails INSTANTLY with a row error and ZERO
 * network traffic — the server stays the source of truth for everything the
 * client cannot know (e.g. deep metadata problems surface as 400 envelopes).
 */

/** The `<input accept=…>` filter AND the client-side extension allowlist. */
const ACCEPT = '.mp3,.flac,.ogg,.m4a,.wav,.opus';
const ALLOWED_EXTENSIONS = ['mp3', 'flac', 'ogg', 'm4a', 'wav', 'opus'];
/** Mirrors the backend multer limit (REQ-UPLOAD-003, 150MB per file). */
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

/**
 * Honest error copy from an ApiError envelope: a VALIDATION_ERROR carries
 * `details[{field,issue}]` (e.g. "unsupported file extension") — the ISSUE
 * is the human-readable truth; any other code falls back to the envelope
 * `message`. Non-ApiError rejections (network down, programming bug) get a
 * generic line — never a raw `String(error)` dump. Page-local (not
 * exported): the UploadPage spec covers it end-to-end through rendered row
 * copy, and exporting it would trip react-refresh/only-export-components.
 */
function uploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
      return error.details[0].issue;
    }
    return error.message;
  }
  return 'Unexpected error';
}

/** Client-side guard: null when the file may be sent, the row error otherwise. */
function validateFile(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return `Unsupported file type — allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'File exceeds the 150 MB upload limit';
  }
  return null;
}

interface UploadRow {
  id: number;
  fileName: string;
  sizeBytes: number;
  /** 0..1 fraction from XHR upload.onprogress (undefined news = 0). */
  progress: number;
  status: 'uploading' | 'success' | 'error';
  result: UploadResult | null;
  errorMessage: string | null;
}

interface UploadsState {
  rows: UploadRow[];
  summary: string | null;
}

type UploadsAction =
  | { type: 'add'; rows: UploadRow[] }
  | { type: 'progress'; id: number; progress: number }
  | { type: 'success'; id: number; result: UploadResult }
  | { type: 'failure'; id: number; message: string }
  | { type: 'batch-done'; summary: string };

function uploadsReducer(state: UploadsState, action: UploadsAction): UploadsState {
  switch (action.type) {
    case 'add':
      return { rows: [...state.rows, ...action.rows], summary: null };
    case 'progress':
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.id ? { ...row, progress: action.progress } : row,
        ),
      };
    case 'success':
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.id
            ? { ...row, status: 'success', result: action.result }
            : row,
        ),
      };
    case 'failure':
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.id
            ? { ...row, status: 'error', errorMessage: action.message }
            : row,
        ),
      };
    case 'batch-done':
      return { ...state, summary: action.summary };
  }
}

/** `"3 uploaded, 1 failed"` — the failed clause only appears when nonzero. */
function summarize(uploaded: number, failed: number): string {
  return `${uploaded} uploaded${failed > 0 ? `, ${failed} failed` : ''}`;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}`;
}

export function UploadPage() {
  const [state, dispatch] = useReducer(uploadsReducer, {
    rows: [],
    summary: null,
  });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextIdRef = useRef(0);
  const upload = useUploadTrack();

  /**
   * The batch pipeline: pre-validate → append rows → fire every surviving
   * file IN PARALLEL (Promise.allSettled, so one rejection never cancels its
   * siblings) → one summary line once every transfer has settled. Counts are
   * closed over per batch: client-side rejects count as failures too.
   */
  const handleFiles = (fileList: File[]) => {
    if (fileList.length === 0) return;
    const rows: UploadRow[] = [];
    const pending: { row: UploadRow; file: File }[] = [];
    for (const file of fileList) {
      const id = ++nextIdRef.current;
      const invalid = validateFile(file);
      const row: UploadRow = {
        id,
        fileName: file.name,
        sizeBytes: file.size,
        progress: 0,
        status: invalid ? 'error' : 'uploading',
        result: null,
        errorMessage: invalid,
      };
      rows.push(row);
      if (!invalid) pending.push({ row, file });
    }
    dispatch({ type: 'add', rows });
    if (pending.length === 0) {
      dispatch({ type: 'batch-done', summary: summarize(0, fileList.length) });
      return;
    }
    let uploaded = 0;
    let failed = fileList.length - pending.length;
    void Promise.allSettled(
      pending.map(({ row, file }) =>
        upload(
          file,
          (fraction) => dispatch({ type: 'progress', id: row.id, progress: fraction }),
        )
          .then((result) => {
            uploaded += 1;
            dispatch({ type: 'success', id: row.id, result });
          })
          .catch((error: unknown) => {
            failed += 1;
            dispatch({
              type: 'failure',
              id: row.id,
              message: uploadErrorMessage(error),
            });
          }),
      ),
    ).then(() => {
      dispatch({ type: 'batch-done', summary: summarize(uploaded, failed) });
    });
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []);
    // Reset so re-picking the SAME file re-fires change (the input keeps no
    // memory once the value is cleared — the FileList is already captured).
    e.currentTarget.value = '';
    handleFiles(files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // required so the drop event fires at all
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(Array.from(e.dataTransfer?.files ?? []));
  };

  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>Upload</h1>

      <div
        data-testid="dropzone"
        className={
          dragOver ? `${styles.dropzone} ${styles.dropzoneActive}` : styles.dropzone
        }
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Icon name="upload" size={32} aria-hidden="true" />
        <p className={styles.dropText}>Drop audio files here</p>
        <Button
          variant="primary"
          className={styles.dropButton}
          onClick={() => inputRef.current?.click()}
        >
          Browse files
        </Button>
        <p className={styles.dropHint}>
          mp3, flac, ogg, m4a, wav, opus — up to 150 MB each
        </p>
        {/* Visually hidden (NOT display:none) so label-click + a11y tree keep
            working; jsdom drives it with fireEvent.change in the specs. */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Add audio files"
          className={styles.fileInput}
          onChange={handleInputChange}
        />
      </div>

      {state.summary !== null && (
        <p className={styles.summary} role="status">
          {state.summary}
        </p>
      )}

      {state.rows.length > 0 && (
        <ul className={styles.list}>
          {state.rows.map((row) => {
            const percent = Math.min(100, Math.round(row.progress * 100));
            return (
              <li key={row.id} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.fileName}>{row.fileName}</span>
                  <span className={styles.size}>{formatMb(row.sizeBytes)} MB</span>
                  {row.status === 'uploading' && (
                    <span className={styles.statusUploading}>
                      Uploading… {percent}%
                    </span>
                  )}
                  {row.status === 'success' && row.result && (
                    <span className={styles.statusSuccess}>
                      <Icon name="check" size={16} aria-hidden="true" />
                      added as {row.result.track.title} by{' '}
                      {row.result.artist.name} (album {row.result.album.title})
                    </span>
                  )}
                  {row.status === 'error' && row.errorMessage && (
                    <span className={styles.statusError}>{row.errorMessage}</span>
                  )}
                </div>
                {row.status === 'uploading' && (
                  <div
                    className={styles.bar}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={`Uploading ${row.fileName}`}
                  >
                    <div className={styles.barFill} style={{ width: `${percent}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

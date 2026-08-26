import { createHash } from 'node:crypto';
import * as path from 'node:path';

/**
 * Pure audio-metadata derivation kernel — single source of truth shared by
 * `prisma/seed.ts` (library scan) and `UploadTrackUseCase` (HTTP upload).
 *
 * Previously these helpers lived in `prisma/seed.ts`; importing a prisma/
 * script from `src/` to reuse them in the upload use case would be a
 * layering smell (application → script tree), so the PURE subset moved here
 * and `seed.ts` re-exports it verbatim — behavior is byte-identical and
 * `seed.spec.ts` keeps importing from `./seed` untouched.
 *
 * Lives in `src/shared/` (NOT `contexts/catalog/domain/`) because
 * `deriveDeterministicId` needs `node:crypto` at RUNTIME and both the
 * ESLint domain rule (bans `node:*` runtime imports in any context's
 * `domain/` tree) and the architecture portfolio test ("domain free of any
 * non-relative RUNTIME import") forbid that. Shared is importable by every
 * layer (boundaries: domain → shared, application → shared).
 *
 * Determinism contract (catalog spec Requirement 8): every catalog row id is
 * a UUID-v5-style digest of a STABLE content key —
 *   - artist: `artist:{name}`
 *   - album:  `album:{artistId}:{title}`
 *   - track:  `track:{relativeFilePath}`
 * The seeder derives ids from the on-disk relative path; the upload flow
 * derives them from the SANITIZED uploaded filename (which becomes the
 * on-disk relative path). Same bytes on disk ⇒ same ids ⇒ an upload followed
 * by a re-seed converges on the same rows instead of duplicating
 * (row-idempotent `ON CONFLICT ("id") DO UPDATE` upserts on both paths).
 */

/** Accepted audio extensions (case-insensitive, compared lowercased). */
export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.m4a', '.wav', '.opus'] as const;

/** Filename-fallback artist when no ` - ` separator (or no artist tag). */
export const FALLBACK_ARTIST_NAME = 'Unknown Artist';

/** Album fallback — the flat `Artist - Title.ext` layout has no album context. */
export const FALLBACK_ALBUM_TITLE = 'Singles';

/**
 * Duration floor. `duration_seconds` feeds the SPA progress bar (divide by
 * total); 0 would produce Infinity/NaN progress. 1s is the sane floor for a
 * truly unparsable file.
 */
const MIN_DURATION_SECONDS = 1;

/** Tag-derived + fallback-resolved metadata for ONE audio file. */
export interface AudioFileMeta {
  artist: string;
  album: string;
  title: string;
  year: number | null;
  trackNo: number | null;
  durationSeconds: number;
}

/** True when the filename carries an accepted audio extension (case-insensitive). */
export function isAudioFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Filename fallback: split `Artist - Title.ext` on the FIRST ` - `.
 *
 * Artist ← left of the first separator, title ← right side WITHOUT the
 * extension. Files without a separator become title-only (artist falls back
 * to `Unknown Artist`). Splits on the FIRST separator only, so titles that
 * themselves contain ` - ` (`A - B - C.flac` → artist `A`, title `B - C`)
 * survive intact.
 */
export function parseArtistTitleFromFilename(fileName: string): {
  artist: string;
  title: string;
} {
  const stem = path.basename(fileName, path.extname(fileName));
  const separator = stem.indexOf(' - ');
  const artist = (separator === -1 ? '' : stem.slice(0, separator)).trim();
  const title = (separator === -1 ? stem : stem.slice(separator + 3)).trim();
  return {
    artist: artist || FALLBACK_ARTIST_NAME,
    title: title || stem.trim() || fileName,
  };
}

/**
 * Duration resolution: `Math.round(format.duration)` when present and
 * positive; the 1s floor otherwise. 0 is NOT acceptable (SPA progress math).
 */
export function resolveDurationSeconds(duration: number | undefined): number {
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    return Math.max(MIN_DURATION_SECONDS, Math.round(duration));
  }
  return MIN_DURATION_SECONDS;
}

/**
 * Release-year resolution: prefer `common.year`; fall back to the first
 * 4-digit run in `common.date` (e.g. `2019-08-09` → 2019); null when neither
 * yields a plausible positive year.
 */
export function resolveYear(year?: number, date?: string): number | null {
  if (typeof year === 'number' && Number.isFinite(year) && year > 0) {
    return Math.round(year);
  }
  if (typeof date === 'string') {
    const match = /(\d{4})/.exec(date);
    if (match) {
      const parsed = Number.parseInt(match[1]!, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

/**
 * Deterministic RFC 4122 v5-style UUID from the SHA-256 of a stable key.
 *
 * Same construction as a real v5 UUID (namespace-less: the key itself
 * carries the `artist:` / `album:` / `track:` namespace prefix), digesting
 * with SHA-256 instead of v5's SHA-1 and taking the first 16 bytes. Version nibble
 * is forced to `0101` (5) and the variant nibble to `10xx` per RFC 4122 —
 * same byte surgery the old PRNG v4 helper did, different digest source.
 * Equal key ⇒ equal UUID ⇒ idempotent re-seeds / re-uploads.
 */
export function deriveDeterministicId(key: string): string {
  const digest = createHash('sha256').update(key, 'utf8').digest();
  const bytes = digest.subarray(0, 16);
  // Version (top nibble of byte 6) = 5.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // Variant (top two bits of byte 8) = 10.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Merge parsed tags with the filename/constant fallbacks into the final
 * per-file metadata. Pure — specs exercise every fallback branch without
 * touching a real audio file.
 */
export function resolveTrackMeta(
  relativePath: string,
  tags: {
    artist?: string;
    album?: string;
    title?: string;
    year?: number;
    date?: string;
    trackNo?: number | null;
    duration?: number;
  },
): AudioFileMeta {
  const fileName = relativePath.split('/').pop() ?? relativePath;
  const fallback = parseArtistTitleFromFilename(fileName);
  const cleanTag = (value: string | undefined): string =>
    typeof value === 'string' ? value.trim() : '';
  const hasTrackNo =
    typeof tags.trackNo === 'number' && Number.isInteger(tags.trackNo) && tags.trackNo > 0;

  return {
    artist: cleanTag(tags.artist) || fallback.artist,
    album: cleanTag(tags.album) || FALLBACK_ALBUM_TITLE,
    title: cleanTag(tags.title) || fallback.title,
    year: resolveYear(tags.year, tags.date),
    trackNo: hasTrackNo ? (tags.trackNo as number) : null,
    durationSeconds: resolveDurationSeconds(tags.duration),
  };
}

// ---------------------------------------------------------------------------
// Upload-side filename sanitization (REQ-UPLOAD-003 path-traversal guard).
//
// The upload flow derives BOTH the on-disk relative path and the track id
// from the client-supplied original filename, so the name must be reduced to
// a safe flat filename BEFORE any derivation happens. Two layers of defense:
//   1. `UploadTrackUseCase` REJECTS any original filename containing path
//      separators outright (400 VALIDATION_ERROR) — a browser always sends a
//      bare basename, so separators mean a hand-crafted request.
//   2. This sanitizer strips filesystem-hostile characters, and the fs
//      adapter (`FsAudioFileWriter`) independently re-checks the resolved
//      path with `path.relative` (mirrors `FsAudioStorage.resolve`).
// ---------------------------------------------------------------------------

/**
 * Filesystem-hostile characters REMOVED from uploaded filenames: the
 * separator/reserved set on any mainstream OS (`/ \ : * ? " < > |`).
 * Everything else — unicode letters, digits, spaces, dashes, apostrophes,
 * parentheses — is preserved so real library names like
 * `Mordecai And The Rigbys (From Regular Show).flac` or `Bublé - Sway.flac`
 * survive intact. Control characters (NUL, newline, DEL…) are stripped
 * separately by code point — see {@link stripControlChars} — because an
 * explicit `\u0000`-range regex trips `no-control-regex` (rightly, in
 * general) while the predicate form states the same intent lint-clean.
 */
const RESERVED_FILENAME_CHARS = /[/\\:*?"<>|]/g;

/**
 * Drop C0 (U+0000–U+001F) and C1 (U+007F–U+009F) control characters —
 * parser-injection vectors (NUL, newlines, escape sequences) that have no
 * business inside a stored filename.
 */
function stripControlChars(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return code > 0x1f && (code < 0x7f || code > 0x9f);
    })
    .join('');
}

/** Whitespace runs (spaces, tabs, NBSP) collapse to a single space. */
const WHITESPACE_RUN = /\s+/g;

/** Cap on the sanitized filename (stem + extension) — keeps paths/portable names sane. */
const MAX_FILENAME_LENGTH = 180;

/**
 * Sanitize an uploaded original filename into the flat relative path used
 * for storage, id derivation, and the DB `file_path`.
 *
 * Slug-like but KEEPS spaces and dashes (the library naming convention is
 * `Artist - Title.ext`): control + filesystem-reserved characters are
 * dropped, whitespace runs collapse, leading/trailing dots and spaces are
 * trimmed (kills hidden-dot files and `..` fragments), and the result is
 * capped at {@link MAX_FILENAME_LENGTH} while preserving the extension.
 * Returns `''` when nothing survives sanitization — the caller MUST reject
 * that with a `ValidationError`.
 *
 * Pure: no fs access, no throws.
 */
export function sanitizeUploadedFilename(fileName: string): string {
  const stripped = stripControlChars(fileName)
    .replace(RESERVED_FILENAME_CHARS, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
  // Trim dots from BOTH ends: leading dots create hidden files; trailing
  // dots break Windows extensions. Interior dots (`.mp3`) survive.
  const trimmed = stripped.replace(/^\.+/, '').replace(/\.+$/, '').trim();
  if (!trimmed) return '';

  const extension = path.extname(trimmed).toLowerCase();
  if (MAX_FILENAME_LENGTH < extension.length) return extension.slice(0, MAX_FILENAME_LENGTH);
  const stem = trimmed.slice(0, trimmed.length - extension.length);
  const cappedStem = stem.slice(0, MAX_FILENAME_LENGTH - extension.length).trim();
  return `${cappedStem}${extension}`;
}

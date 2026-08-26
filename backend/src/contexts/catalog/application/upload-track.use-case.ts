import { parseBuffer } from 'music-metadata';

import {
  type AudioFileMeta,
  deriveDeterministicId,
  resolveTrackMeta,
  sanitizeUploadedFilename,
} from '../../../shared/audio-meta';
import { ValidationError } from '../../../shared/errors/validation-error';
import type { AudioFileWriterPort } from '../domain/ports/audio-file-writer.port';
import type { CatalogEntryInput, CatalogRepositoryPort } from '../domain/ports/catalog-repository.port';

/**
 * Response contract for `POST /api/v1/tracks/upload` (REQ-UPLOAD-001). The
 * frontend consumes EXACTLY this shape: the created/updated track plus the
 * artist and album it landed under. `filePath` is deliberately absent — it
 * is an internal storage detail that never leaks over HTTP (R4 guard,
 * mirrors `Track.toPrimitive()`).
 */
export interface UploadTrackResult {
  track: { id: string; title: string; durationSeconds: number; albumId: string };
  artist: { id: string; name: string };
  album: { id: string; title: string };
}

/**
 * Driving use case (application layer) — authenticated track upload
 * (REQ-UPLOAD-001 … REQ-UPLOAD-004).
 *
 * Pipeline (deliberately ordered):
 *   1. VALIDATE the original filename — path separators are REJECTED
 *      outright (a browser always sends a bare basename, so separators mean
 *      a hand-crafted traversal attempt), then it is sanitized into the
 *      flat `Artist - Title.ext` relative path (slug-like but spaces and
 *      dashes preserved — see `sanitizeUploadedFilename`).
 *   2. PARSE metadata from the in-memory bytes with `music-metadata`
 *      `parseBuffer`, resolving tags through the SAME fallback chain as the
 *      seeder (`resolveTrackMeta`: tag → filename split → `Singles` /
 *      `Unknown Artist`, duration floored at 1s). A corrupt or tagless file
 *      is NOT rejected — it degrades to the filename fallbacks, exactly
 *      like `scanAudioFiles` degrades in the seeder ("the file IS part of
 *      the library").
 *   3. DERIVE deterministic ids with the shared kernel
 *      (`artist:{name}` / `album:{artistId}:{title}` /
 *      `track:{relativePath}`) — the SAME helpers `prisma/seed.ts` uses, so
 *      an upload followed by a re-seed converges on the same rows instead
 *      of duplicating them (the seeder upserts by the same ids).
 *   4. WRITE the bytes via `AudioFileWriterPort` FIRST, then UPSERT the
 *      catalog rows via `CatalogRepositoryPort.upsertCatalogEntry` in one
 *      transaction. File-before-DB means a failed upsert can leave an
 *      orphan file (harmless — invisible until a matching catalog row
 *      appears) while the reverse order could expose a streamable DB row
 *      whose file is missing (a 404 the user can click).
 *   5. RETURN the contract object — every field is already known from the
 *      derivation, so no re-read is needed.
 *
 * Idempotency (REQ-UPLOAD-004): re-uploading the same track derives the
 * SAME relative path ⇒ the same ids ⇒ the writer overwrites the file and
 * the upsert updates the same rows. No duplicates, ever.
 *
 * AUTHORIZATION DECISION (demo scope): ANY authenticated user may upload —
 * there is no admin role or per-user quota. The product brief for this
 * portfolio demo explicitly states "any registered user may upload"; the
 * identity context has no role concept, and inventing one for a single
 * write endpoint would grow the system without a requirement behind it.
 * The route stays behind `JwtAuthGuard` (401 unauthenticated), which is the
 * only gate the current bounded contexts can express honestly. Revisit if
 * the demo ever becomes multi-tenant.
 *
 * Framework-free by design: only `domain/` + `shared/` imports plus the
 * `music-metadata` pure-parsing library (same dependency the seeder uses;
 * the architecture portfolio test bans non-relative imports in `domain/`
 * only, and the application layer has no such restriction). The concrete
 * `AudioFileWriterPort` / `CatalogRepositoryPort` implementations are
 * injected via DI tokens bound in `CatalogModule`.
 */
export class UploadTrackUseCase {
  constructor(
    private readonly catalog: CatalogRepositoryPort,
    private readonly writer: AudioFileWriterPort,
  ) {}

  async execute(input: { originalFilename: string; bytes: Buffer }): Promise<UploadTrackResult> {
    // REQ-UPLOAD-003 — path-traversal guard, layer 1: the original filename
    // MUST be a bare filename. Sanitization below strips hostile characters,
    // but separators are rejected before any derivation so a crafted name
    // never even reaches the id digest.
    if (input.originalFilename.includes('/') || input.originalFilename.includes('\\')) {
      throw new ValidationError('Upload filename must be a bare filename, not a path', [
        { field: 'file', issue: 'filename must not contain path separators' },
      ]);
    }
    const relativePath = sanitizeUploadedFilename(input.originalFilename);
    if (!relativePath) {
      throw new ValidationError('Upload filename is empty after sanitization', [
        { field: 'file', issue: 'filename contains no usable characters' },
      ]);
    }

    // Tag parse with seeder-identical degradation: a parse failure falls
    // back to the filename chain (resolveTrackMeta with NO tags) instead of
    // rejecting the upload. parseBuffer sniffs the container from the bytes
    // themselves, so every format in AUDIO_EXTENSIONS resolves without a
    // caller-supplied MIME type.
    let meta: AudioFileMeta;
    try {
      const parsed = await parseBuffer(input.bytes);
      meta = resolveTrackMeta(relativePath, {
        artist: parsed.common.artist,
        album: parsed.common.album,
        title: parsed.common.title,
        year: parsed.common.year,
        date: parsed.common.date,
        trackNo: parsed.common.track?.no ?? null,
        duration: parsed.format.duration,
      });
    } catch {
      // Corrupt/unsupported bytes — degrade, never drop (seeder parity).
      meta = resolveTrackMeta(relativePath, {});
    }

    // Deterministic ids — SAME derivation the seeder applies (see the
    // shared kernel docstring). trackNumber mirrors the seeder's
    // `trackNo ?? <position>` fallback with position 1: uploads land in a
    // flat single-file slot, and a re-seed re-derives it from album order.
    const artistId = deriveDeterministicId(`artist:${meta.artist}`);
    const albumId = deriveDeterministicId(`album:${artistId}:${meta.album}`);
    const trackId = deriveDeterministicId(`track:${relativePath}`);

    const entry: CatalogEntryInput = {
      artist: { id: artistId, name: meta.artist },
      album: { id: albumId, title: meta.album, releaseYear: meta.year, artistId },
      track: {
        id: trackId,
        title: meta.title,
        durationSeconds: meta.durationSeconds,
        // Seed-style rooted path — matches FsAudioStorage.resolve contract.
        filePath: `/audio/${relativePath}`,
        trackNumber: meta.trackNo ?? 1,
        albumId,
      },
    };

    await this.writer.writeFile(relativePath, input.bytes);
    await this.catalog.upsertCatalogEntry(entry);

    return {
      track: {
        id: trackId,
        title: meta.title,
        durationSeconds: meta.durationSeconds,
        albumId,
      },
      artist: { id: artistId, name: meta.artist },
      album: { id: albumId, title: meta.album },
    };
  }
}

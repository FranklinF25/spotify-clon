import type { PrismaClient } from '@prisma/client';

import { Playlist } from '../domain/playlist.entity';
import type {
  PlaylistRow,
  PlaylistTrackRow,
  PlaylistsRepositoryPort,
} from '../domain/ports/playlists-repository.port';

/**
 * Prisma-backed `PlaylistsRepositoryPort` (F5 — design §7 + §9).
 *
 * Plain class (no `@Injectable`) — wired through `useExisting` in
 * `PlaylistsModule` (PR-2) so it stays constructible and testable without a
 * Nest `TestingModule`. `PrismaClient` is constructor-injected (provided
 * globally by `PrismaModule`).
 *
 * R-app-1 resolution (load-bearing): every query filters on the leading edge
 * of the composite PK (`where: { playlistId }`). The model declares
 * `@@id([playlistId, position])` for typed access; the DB-side PK is declared
 * DEFERRABLE INITIALLY DEFERRED in migration 0002 (the single source of
 * truth — migrations are hand-written + deploy-only). The DEFERRABLE behavior
 * is what makes the single-statement `reorder` UPDATE-CASE safe.
 *
 * Transactional methods (LOCKED technical #9): `addTrack`,
 * `removeTrackAtPosition`, and `reorder` each wrap their writes in one
 * `prisma.$transaction`. The application layer never sees the boundary.
 *
 * Mappers (`toPlaylistRow`, `toPlaylistTrackRow`) call
 * `Playlist.reconstruct()` / shape the row straight — NO re-validation (the
 * DB is the trusted source of truth, mirrors the catalog adapter).
 */
export class PrismaPlaylistsRepository implements PlaylistsRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: {
    userId: string;
    title: string;
    now: Date;
  }): Promise<PlaylistRow> {
    // Pass createdAt + updatedAt explicitly so the row matches the caller's
    // `now` (the in-memory fake does the same — keeps the contract uniform
    // and lets specs assert deterministic timestamps).
    const row = await this.prisma.playlist.create({
      data: {
        userId: input.userId,
        title: input.title,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toPlaylistRow(row);
  }

  async findById(id: string): Promise<PlaylistRow | null> {
    const row = await this.prisma.playlist.findUnique({ where: { id } });
    return row ? toPlaylistRow(row) : null;
  }

  async findByOwner(userId: string): Promise<PlaylistRow[]> {
    // newest first (REQ-P-003 hot path uses idx_playlists_user_id).
    const rows = await this.prisma.playlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPlaylistRow);
  }

  async updateTitle(id: string, title: string, now: Date): Promise<PlaylistRow | null> {
    try {
      const row = await this.prisma.playlist.update({
        where: { id },
        data: { title, updatedAt: now },
      });
      return toPlaylistRow(row);
    } catch {
      // P2025 (record not found) — surface as null so the use case can
      // promote to NotFoundError uniformly.
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    // FK CASCADE on playlist_tracks.playlist_id clears the junction rows in
    // one statement (REQ-P-006). The delete returns the deleted row or
    // throws P2025 if missing — the use case has already existence-checked
    // via loadOwnedPlaylist, so a missing here is a concurrent delete (void
    // is the correct response either way).
    await this.prisma.playlist.deleteMany({ where: { id } });
  }

  async addTrack(input: {
    playlistId: string;
    trackId: string;
    now: Date;
  }): Promise<PlaylistTrackRow> {
    // INSERT … SELECT max+1 inside one transaction (LOCKED technical #9).
    // The interactive transaction callback lets us read max(position) and
    // insert under the same snapshot, so concurrent adds serialise correctly.
    return await this.prisma.$transaction(async (tx) => {
      const max = await tx.playlistTrack.aggregate({
        where: { playlistId: input.playlistId },
        _max: { position: true },
      });
      const position = (max._max.position ?? 0) + 1;
      const row = await tx.playlistTrack.create({
        data: {
          playlistId: input.playlistId,
          position,
          trackId: input.trackId,
          addedAt: input.now,
        },
      });
      return toPlaylistTrackRow(row);
    });
  }

  async removeTrackAtPosition(input: {
    playlistId: string;
    position: number;
  }): Promise<void> {
    // Compact-on-remove (design §9.1 verbatim): DELETE the addressed row,
    // then UPDATE trailing rows position-1. Both inside one $transaction so
    // the compact never partially applies. The use case pre-checks the
    // position exists; if a concurrent delete removed it first, the DELETE
    // removes 0 rows and the UPDATE is a no-op (correct).
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        DELETE FROM "playlist_tracks"
        WHERE "playlist_id" = ${input.playlistId}::uuid
          AND "position"     = ${input.position}`,
      this.prisma.$executeRaw`
        UPDATE "playlist_tracks"
        SET "position" = "position" - 1
        WHERE "playlist_id" = ${input.playlistId}::uuid
          AND "position" > ${input.position}`,
    ]);
  }

  async reorder(input: {
    playlistId: string;
    from: number;
    to: number;
  }): Promise<PlaylistTrackRow[]> {
    // Single-statement UPDATE-CASE inside one transaction (design §9.2
    // verbatim). The DEFERRABLE INITIALLY DEFERRED composite PK (migration
    // 0002) is what makes this safe: PostgreSQL defers the uniqueness check
    // to COMMIT, so the transient state where two rows share a position
    // during the CASE evaluation does NOT abort the statement. Without
    // DEFERRABLE, this would fail with 'duplicate key value violates unique
    // constraint "playlist_tracks_pkey"'.
    await this.prisma.$executeRaw`
      UPDATE "playlist_tracks"
      SET "position" = CASE
        WHEN "position" = ${input.from} THEN ${input.to}
        WHEN ${input.from} < ${input.to} AND "position" > ${input.from} AND "position" <= ${input.to} THEN "position" - 1
        WHEN ${input.from} > ${input.to} AND "position" >= ${input.to} AND "position" < ${input.from} THEN "position" + 1
        ELSE "position"
      END
      WHERE "playlist_id" = ${input.playlistId}::uuid`;

    const rows = await this.findOrderedTrackIds(input.playlistId);
    return rows;
  }

  async findOrderedTrackIds(playlistId: string): Promise<PlaylistTrackRow[]> {
    const rows = await this.prisma.playlistTrack.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
    });
    return rows.map(toPlaylistTrackRow);
  }
}

// ---------------------------------------------------------------------------
// Mappers — Prisma row -> port row. No re-validation (DB is trusted). The
// playlist row is shaped straight (the entity factory's invariant is only
// relevant on the write path; reads go through reconstruct at the use-case
// layer when ownership needs to be checked).
// ---------------------------------------------------------------------------

function toPlaylistRow(row: {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}): PlaylistRow {
  // Validate the row shape defensively (Playlist.reconstruct trusts any
  // input, but the row interface still requires the five fields).
  return Playlist.reconstruct({
    id: row.id,
    userId: row.userId,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }).toPrimitive();
}

function toPlaylistTrackRow(row: {
  playlistId: string;
  position: number;
  trackId: string;
  addedAt: Date;
}): PlaylistTrackRow {
  return {
    playlistId: row.playlistId,
    position: row.position,
    trackId: row.trackId,
    addedAt: row.addedAt,
  };
}

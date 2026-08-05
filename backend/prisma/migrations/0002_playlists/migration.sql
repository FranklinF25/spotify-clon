-- Playlists bounded context — F5 (first write-side context).
-- Composite PK (playlist_id, position) DEFERRABLE INITIALLY DEFERRED: the
-- reorder use case (REQ-P-010) rewrites positions in a single UPDATE-CASE
-- statement inside one transaction. Without DEFERRABLE, PostgreSQL's NOT
-- DEFERRABLE PK check fires per-row and aborts the UPDATE the moment two rows
-- transiently share a position. DEFERRABLE defers the check to COMMIT.
-- DDL-only (LOCKED Decision #8): no PL/pgSQL (test-db.ts splitter fragility
-- on BEGIN-END blocks).

-- CreateTable: playlists
CREATE TABLE "playlists" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id"     UUID NOT NULL,
    "title"       TEXT NOT NULL,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable: playlist_tracks (composite PK declared separately, below —
-- the DEFERRABLE clause is the load-bearing detail, see header).
CREATE TABLE "playlist_tracks" (
    "playlist_id" UUID NOT NULL,
    "position"    INTEGER NOT NULL,
    "track_id"    UUID NOT NULL,
    "added_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Composite PK — DEFERRABLE so the reorder's single-statement UPDATE-CASE can
-- transiently violate uniqueness and only validate at COMMIT (design R3).
ALTER TABLE "playlist_tracks"
    ADD CONSTRAINT "playlist_tracks_pkey"
    PRIMARY KEY ("playlist_id", "position")
    DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex: list-own-playlists hot path (REQ-P-003, design R4).
CREATE INDEX "playlists_user_id_idx" ON "playlists"("user_id");

-- CreateIndex: FK reverse check on tracks DELETE (rare; defensive — design R4).
-- track_id ON DELETE RESTRICT means a DELETE on tracks triggers a lookup here;
-- without the index it degrades to a seq scan as playlists grow.
CREATE INDEX "playlist_tracks_track_id_idx" ON "playlist_tracks"("track_id");

-- AddForeignKey: playlists.user_id -> users.id (CASCADE: deleting a user
-- cleans their playlists — same posture as refresh_tokens.user_id).
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: playlist_tracks.playlist_id -> playlists.id (CASCADE:
-- deleting a playlist cleans its rows in one statement — REQ-P-006 invariant).
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_fkey"
    FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: playlist_tracks.track_id -> tracks.id (RESTRICT: catalog
-- tracks are seed-only/immutable; RESTRICT prevents accidental orphaning.
-- Silent-omit (REQ-P-008) covers the out-of-band-removal edge case.)
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_track_id_fkey"
    FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

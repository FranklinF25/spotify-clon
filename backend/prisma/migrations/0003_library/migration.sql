-- Library bounded context — F6 (saved albums join table).
-- Plain composite PK (user_id, album_id): NOT DEFERRABLE. Unlike
-- playlist_tracks (whose reorder UPDATE-CASE needs deferred uniqueness
-- checking), library's only writer is a row-at-a-time upsert that can never
-- transiently violate its own target pair (design D2).
-- DDL-only (F5 Decision #8): no PL/pgSQL (test-db.ts splitter fragility).

-- CreateTable: user_library_albums
CREATE TABLE "user_library_albums" (
    "user_id"  UUID NOT NULL,
    "album_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_library_albums_pkey" PRIMARY KEY ("user_id", "album_id")
);

-- CreateIndex: FK reverse check on albums DELETE (REQ-L-006 cascade hot
-- path — mirrors playlist_tracks_track_id_idx, design D3).
CREATE INDEX "user_library_albums_album_id_idx" ON "user_library_albums"("album_id");

-- AddForeignKey: user_id → users.id (CASCADE: deleting a user removes their
-- library rows — same posture as refresh_tokens/playlists).
ALTER TABLE "user_library_albums" ADD CONSTRAINT "user_library_albums_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: album_id → albums.id (CASCADE — REQ-L-006: deleting an
-- album removes every saved reference; spec-mandated, unlike playlist_tracks'
-- RESTRICT on track_id, because the library spec explicitly pins the
-- album-delete cascade scenario).
ALTER TABLE "user_library_albums" ADD CONSTRAINT "user_library_albums_album_id_fkey"
    FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

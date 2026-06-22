-- Catalog bounded context — artists, albums, tracks (DESIGN §Catalog Data Model).
--
-- CO-catalog-3 (carry-over): `CREATE EXTENSION unaccent` requires PostgreSQL
-- SUPERUSER on managed services (RDS / Aurora). On testcontainers the default
-- `postgres` user is superuser so this works without admin help. For deploy
-- scenarios an operator with SUPERUSER must pre-create the extension before
-- running this migration; otherwise this statement fails loudly.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- DESIGN DEVIATION (apply phase, CAT-PR1-02):
-- The design.md specifies generated columns expressed as
--   `to_tsvector('simple', unaccent(coalesce("name", '')))`
-- but PostgreSQL rejects this because `public.unaccent(text)` is STABLE
-- (not IMMUTABLE) — the unaccent function consults a dictionary whose contents
-- could in principle change, so PostgreSQL conservatively refuses to use it
-- inside a STORED GENERATED column.
--
-- The standard workaround (PostgreSQL wiki + many production deployments) is
-- to wrap the dictionary-bound call in a SQL function marked IMMUTABLE. The
-- wrapper is genuinely immutable in practice because:
--   1. The dictionary name is bound at function-creation time.
--   2. The unaccent dictionary is static (only changes via ALTER TEXT SEARCH
--      DICTIONARY, which is an admin DDL operation).
--   3. The output is a deterministic pure function of the input text.
-- This is the same approach used bydjango.contrib.postgres, large-scale search
-- deployments, and Supabase's docs. The wrapper is schema-scoped to `public`
-- so the `catalog` context owns its name clearly.
CREATE OR REPLACE FUNCTION catalog_unaccent(input text) RETURNS text AS
$$
    SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE STRICT;

-- CreateTable: artists
CREATE TABLE "artists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "image_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name_tsv" TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', catalog_unaccent(coalesce("name", '')))) STORED,

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable: albums
CREATE TABLE "albums" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "release_year" INTEGER,
    "cover_url" TEXT,
    "artist_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title_tsv" TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', catalog_unaccent(coalesce("title", '')))) STORED,

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable: tracks
CREATE TABLE "tracks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "track_number" INTEGER NOT NULL,
    "album_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title_tsv" TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', catalog_unaccent(coalesce("title", '')))) STORED,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: b-tree for FK lookups
CREATE INDEX "albums_artist_id_idx" ON "albums"("artist_id");
CREATE INDEX "tracks_album_id_idx" ON "tracks"("album_id");

-- CreateIndex: GIN for full-text search (proposal Decision 3; overrides PRD F4).
-- The `simple` config only lowercases — it does NOT fold accents, so every
-- generated column expression above wraps the input in `catalog_unaccent(...)`
-- (the IMMUTABLE wrapper around `public.unaccent`). The query side
-- (CAT-PR3c-02) must do the same.
CREATE INDEX "artists_name_tsv_idx" ON "artists" USING GIN ("name_tsv");
CREATE INDEX "albums_title_tsv_idx" ON "albums" USING GIN ("title_tsv");
CREATE INDEX "tracks_title_tsv_idx" ON "tracks" USING GIN ("title_tsv");

-- AddForeignKey: cascade matches DESIGN §2.2 — deleting an artist removes their
-- albums, and deleting an album removes its tracks.
ALTER TABLE "albums" ADD CONSTRAINT "albums_artist_id_fkey"
    FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tracks" ADD CONSTRAINT "tracks_album_id_fkey"
    FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

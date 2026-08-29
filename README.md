# Spotify Clon — a streaming app for the library you already own

[![CI](https://github.com/FranklinF25/spotify-clon/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/FranklinF25/spotify-clon/actions/workflows/ci.yml)

A full-stack music streaming platform that turns a folder of your own audio files into a browsable, searchable, playable catalog — with authentication, playlists, saved albums, a track uploader, and live interactive API documentation. Built as a production-discipline portfolio piece: real hexagonal boundaries, executable architecture tests, and contract-drift guards on every seam.

## Quick start (the Docker demo)

```bash
docker compose up -d --build
```

Then open **https://localhost** — register an account, and you're in.

> **Why the "not secure" warning?** The stack serves TLS with a self-signed certificate because `localhost` can't obtain a CA-signed one. This is deliberate: the auth design rotates refresh tokens in an `httpOnly` **`Secure`** cookie, and browsers refuse `Secure` cookies over plain HTTP — so a production-like demo *requires* HTTPS locally. Accept the browser exception; the connection is fully encrypted (TLS 1.2/1.3). See [the TLS story](#the-tls-story) for details.

**Your music**: drop audio files (`.mp3 .flac .ogg .m4a .wav .opus`) into `./audio/` — the seed container scans them at startup, reads artist/album/title from the file's embedded tags (with `Artist - Title.ext` filename fallbacks), and builds the catalog. Prefer the UI? Sign in and use **Upload** — files land in the same library with metadata parsed server-side, immediately searchable.

| What | Where |
| --- | --- |
| App | https://localhost |
| API docs (Scalar, dark) | https://localhost/api/v1/reference |
| OpenAPI 3.0.3 document | https://localhost/api/v1/openapi.json |
| Health probe | https://localhost/health |

## What's inside

| Feature | Notes |
| --- | --- |
| Auth | argon2id hashing, short-lived JWT access tokens, rotating refresh tokens in `httpOnly` Secure cookies, single-flight refresh on the client |
| Catalog | Artists / albums / tracks read models, pagination, PostgreSQL full-text search (tsvector + GIN) |
| Playback | HTTP Range streaming (200/206/416), per-format `Content-Type` (FLAC/MP3/OGG/…), seek support |
| Live search | Debounced as-you-type results, playable directly from the results |
| Playlists | Create / rename / delete, add via track-search picker, remove, reorder |
| Saved albums | "Mi biblioteca" unified view with instant save/remove |
| Upload | Multi-file drag & drop, per-file progress, tag-derived catalog entries, idempotent re-uploads |
| Landing | Public marketing page; authed users go straight to the app |

## Stack

| Layer | Technology |
| --- | --- |
| Backend | NestJS 11, TypeScript, Prisma 6, PostgreSQL 16, zod 3 |
| Frontend | React 18, Vite 5, TanStack Query 5, zustand 4, zod 3, CSS Modules |
| Infra | Docker Compose (5-service DAG: db → migrate → seed → backend → frontend), nginx reverse proxy with TLS |
| Docs | Scalar API reference generated from the zod schemas via `zod-to-openapi` |

## Architecture

**Backend — hexagonal (ports & adapters), organized by bounded context.**

```
backend/src/contexts/
├── identity/    # auth, users, refresh rotation
├── catalog/     # artists/albums/tracks read models, search, upload
├── playback/    # Range streaming
├── playlists/   # owned playlists + ordered tracks
└── library/     # saved albums
```

Each context splits into `application/` (use cases, one `execute()` each), `domain/` (entities, value objects, `ports/` interfaces), and `infrastructure/` (Nest controllers, Prisma repositories, fs adapters). The domain has zero framework and zero `node:*` runtime imports — **enforced by tests, not convention** (ts-morph architecture suite + `eslint-plugin-boundaries`).

**Frontend — atomic design** (`atoms → molecules → organisms → templates → pages`) with its own executable architecture test, including a runtime assertion that the `<audio>` element's identity is stable across route navigations.

### The zero-drift guarantees

Every contract in this repo is enforced by a test that fails loudly:

| Guard | What it proves |
| --- | --- |
| `backend/test/architecture.spec.ts` | Domain purity, single-execute use cases, controllers only in infrastructure (ts-morph AST scan) |
| `backend/test/openapi-coverage.spec.ts` | The generated OpenAPI document's route set matches the controllers' actual routes — bidirectionally |
| `frontend/src/test/contract/` | The SPA's zod mirrors match live backend response shapes (MSW contract/drift suite) |
| `backend/test/docker/smoke.sh` | 27 black-box scenarios against the real TLS stack, one command: `make docker-smoke` |

Because the OpenAPI document is generated from the **same zod schemas that validate requests at runtime**, the documentation cannot drift from behavior — there is only one source of truth.

## Your music, deterministically

Both the seeder and the upload endpoint derive stable IDs from content identity (`sha256`-based UUIDs over `artist:{name}`, `album:{artist}:{title}`, `track:{path}`). Seed the same files twice, or upload a file that's also on disk — you get an upsert, never a duplicate. Added files later? `docker compose up --force-recreate seed` re-syncs incrementally (it never deletes).

## The TLS story

`config.ts` fail-fasts if `COOKIE_SECURE=false` in production: the refresh cookie **must** be `Secure`. Browsers won't set `Secure` cookies over HTTP, so a production-faithful local demo requires HTTPS — and `localhost` can't get a CA-signed certificate. Hence self-signed, deliberately, with the trade-off documented (the browser warning) and the TLS posture still real: HTTP→HTTPS 301 redirect, TLS 1.2/1.3 only, modern ECDHE cipher suites.

## Testing

```bash
pnpm -C backend test     # 726 tests: unit, architecture, contract, e2e (Testcontainers)
pnpm -C frontend test    # 390 tests: unit, contract-drift (MSW), architecture
make docker-smoke        # 27 black-box scenarios over the real TLS stack
```

## Repository layout

```
backend/    # NestJS hexagonal API (contexts/, shared/, prisma/, test/)
frontend/   # React SPA (features/, components/, pages/, store/, lib/)
audio/      # your music library (gitignored, mounted read-only into containers)
deploy-ish: docker-compose.yml, frontend/nginx.conf, Makefile
```

## Demo-scope notes

- JWT secrets in `docker-compose.yml` are demo-only placeholders (documented in-file); real deployments inject secrets via environment.
- `./audio/` is intentionally gitignored — bring your own library.
- One smoke scenario (HTTP→301 on port 80) requires port 80 free on the host.

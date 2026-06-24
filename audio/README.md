# Audio Directory

This directory holds the audio files used by the **human demo flow** of the
Spotify clone (PRD §10.5: *login → buscar → reproducir → seek*). It is
mounted read-only into the backend container at `/data/audio` when the
compose `demo` profile is active (see the repo root `docker-compose.yml`).

> **Legal constraint (PRD §9.1).** Only **Creative Commons**,
> **royalty-free**, or **own compositions** may live here. Do NOT commit
> copyrighted audio you do not have the rights to distribute. Every file
> placed in this directory MUST have a matching entry in the
> [Attribution Log](#attribution-log) below.

---

## Why this directory exists

The playback bounded context serves MP3 bytes over HTTP `Range` requests
(`GET /api/v1/tracks/:id/stream`). The seed (`backend/prisma/seed.ts`)
writes track file paths shaped like `/audio/<album>/<track>.mp3`, and
`FsAudioStorage` resolves them under the configured `AUDIO_STORAGE_PATH`.
For the human demo to actually play something, real MP3 bytes must exist
here under matching `<album>/<track>.mp3` paths.

This is **not** part of the automated test suite — the deterministic
silent fixture used by the e2e + integration specs lives at
`backend/test/fixtures/audio/sample.mp3` (a committed binary, gitignored
except via a two-layer `!` exception in `.gitignore`). The two are
distinct: this directory is for the human demo, the fixture is for CI.

---

## Suggested sources

All of these offer CC / royalty-free / public-domain music. Verify each
track's exact license before downloading — the license determines whether
attribution is required and whether the track can be modified.

| Source | URL | Typical license |
|---|---|---|
| Free Music Archive | https://freemusicarchive.org/ | CC BY, CC BY-NC, CC0 (varies) |
| ccMixter | https://ccmixter.org/ | CC BY, CC Plus (mostly attribution) |
| Bensound | https://www.bensound.com/ | Bensound license (attribution required for free use) |
| Incompetech | https://incompetech.com/ | CC BY 4.0 (Kevin MacLeod) |
| Pixabay Music | https://pixabay.com/music/ | Pixabay Content License (royalty-free) |

YouTube Audio Library is also fine for royalty-free selection but is
**not** CC-licensed — it is fine for personal demo use but do not
redistribute the tracks.

---

## Attribution Log

Add one entry per file placed under this directory. Use the template
below. Keep entries sorted by file path.

### Template

```
### `<relative/path/within/audio>/<file>.mp3`

- **Title**: <track title>
- **Author / Artist**: <name>
- **Source URL**: <direct link to the track page on the source site>
- **License**: <e.g. CC BY 4.0, CC0, Bensound License, own composition>
- **License URL**: <link to the license text>
- **Modifications**: <none | trimmed to 30s | normalized volume | …>
- **Date added**: <YYYY-MM-DD>
```

### Entries

<!-- Add new entries below this comment. Replace this HTML comment with
     the first entry when you place your first audio file. -->

---

## Deploying audio for the demo

1. Place MP3 files under this directory at `<album>/<track>.mp3` paths
   that match what `prisma/seed.ts` writes to the `file_path` column.
2. From the repo root, run `docker-compose --profile demo up --build`.
   This starts PostgreSQL and the backend with the audio mount wired.
3. Run the seed against the running stack:
   `pnpm --filter backend db:seed` (or `prisma db seed` from `backend/`).
4. Open the frontend and play a track — the request flows
   `GET /api/v1/tracks/<id>/stream` → `PlaybackController` →
   `FsAudioStorage` → `/data/audio/<album>/<track>.mp3` inside the
   container, which maps back to `./audio/<album>/<track>.mp3` here.

---

## What NOT to commit

- **Actual MP3 bytes** — this directory is gitignored (see `.gitignore`:
  `audio/` + `*.mp3`). Only this README is tracked, via a `!audio/README.md`
  exception so attribution stays visible to every contributor.
- **Copyrighted audio you do not have rights to** — even if it is never
  pushed, keeping it locally exposes the project to legal risk.
- **Large multi-megabyte files** — for the demo, 30–60 second clips are
  enough. Re-encode with `ffmpeg -i in.mp3 -t 30 -b:a 96k out.mp3` to
  trim.

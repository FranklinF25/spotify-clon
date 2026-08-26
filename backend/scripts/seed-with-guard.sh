#!/bin/sh
# seed-with-guard.sh — schema-reachability guard for the idempotent seed
# (REQ-DOCKER-005, design §8.2 — sync semantics).
#
# seed.ts is now ROW-IDEMPOTENT: it scans <AUDIO_STORAGE_PATH>/audio and
# upserts via INSERT ... ON CONFLICT ("id") DO UPDATE with deterministic
# content-derived ids (artist/album/track stable keys). Re-running it SYNCs
# incremental changes (new files, retagged titles) instead of accumulating
# duplicates — so the old count-guard skip ("already populated → skip") is
# GONE. Both an empty and a populated catalog now proceed to run the seed;
# warm restarts converge the DB to the on-disk library, never skipping.
#
# What is KEPT is the schema-reachability check: the count query must SUCCEED
# before the seed runs. A failure (schema not migrated, DB unreachable)
# MUST NOT collapse into "empty" and fall through to the seed, because
# seeding into a missing schema would crash mid-way (S1 fails-loudly).
#
# Lives under backend/scripts/ (NOT backend/src/) so it does NOT appear in
# the REQ-DOCKER-009 diff guard. C1 — COPY'd into the builder image by the
# backend Dockerfile.
#
# Exit codes:
#   0 — schema reachable AND seed ran successfully (or no-op'd safely)
#   2 — reachability query failed (schema not migrated / DB unreachable)
#
# `set -eu` (NOT `-o pipefail`): this script runs under `/bin/sh` (dash in the
# node image), which does NOT support `pipefail`. The script has no pipelines
# (the `node -e` probe + `exec ts-node` are single commands), so `pipefail`
# was both unsupported here and unnecessary. `-u` catches unset vars; `-e`
# fails fast. See REQ-DOCKER-005 (S1 fails-loudly exit 2 handled in `case`).
set -eu

# Reachability step — the node script exits: 0 = query ran (catalog state is
# irrelevant now: empty AND populated both proceed to the idempotent sync),
# 2 = error (count query threw: schema not migrated, DB unreachable). stderr
# is left VISIBLE for diagnostics (no 2>&1 suppression). `node ... && rc=0 ||
# rc=$?` captures the exit code WITHOUT tripping `set -e`.
node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    await p.artist.count();
    await p.\$disconnect();
    process.exit(0);   // 0 = schema reachable — proceed to the sync
  })().catch(() => process.exit(2));
" && rc=0 || rc=$?

case "$rc" in
  0) echo '[seed] Schema reachable — running seed (idempotent sync).'; ;;
  *) echo "[seed] reachability query failed (rc=$rc) — schema not migrated?" >&2; exit 2 ;;
esac

# seed.ts imports loadConfig (../src/config) — run via ts-node in the builder
# target (design §8.1 fork b'). Byte-identical to the dev `db:seed` script.
# seed.ts is NOT compiled into dist/, NOT modified.
exec pnpm exec ts-node prisma/seed.ts

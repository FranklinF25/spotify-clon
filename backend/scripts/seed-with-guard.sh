#!/bin/sh
# seed-with-guard.sh — count-guard wrapper (REQ-DOCKER-005, design §8.2).
#
# seed.ts is NOT row-idempotent — re-running it accumulates duplicates because
# every run generates fresh (deterministic) UUIDs that Prisma sees as new rows.
# This guard makes the `seed` container idempotent at the `up` level: first boot
# seeds the empty catalog; later boots (warm restart) skip.
#
# Lives under backend/scripts/ (NOT backend/src/) so it does NOT appear in the
# REQ-DOCKER-009 diff guard. C1 — COPY'd into the builder image by the backend
# Dockerfile.
#
# Exit codes:
#   0 — already seeded (skipped) OR seed ran successfully
#   2 — count query failed (schema not migrated / DB unreachable) — FAILS LOUDLY
#       (S1): a failure MUST NOT collapse into "empty" and fall through to the
#       seed, because seeding into a missing schema would crash mid-way.
set -euo pipefail

# Count step — the node script exits: 0 = already seeded, 1 = empty, 2 = error
# (count query threw: schema not migrated, DB unreachable). stderr is left
# VISIBLE for diagnostics (no 2>&1 suppression). `node ... && rc=0 || rc=$?`
# captures the exit code WITHOUT tripping `set -e`.
node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    const [a, t] = await Promise.all([p.artist.count(), p.track.count()]);
    await p.\$disconnect();
    process.exit(a > 0 || t > 0 ? 0 : 1);   // 0 = already seeded, 1 = empty
  })().catch(() => process.exit(2));
" && rc=0 || rc=$?

case "$rc" in
  0) echo '[seed] Catalog already populated — skipping (count-guard).'; exit 0 ;;
  1) echo '[seed] Catalog empty — running seed.' ;;
  *) echo "[seed] count query failed (rc=$rc) — schema not migrated?" >&2; exit 2 ;;
esac

# seed.ts imports loadConfig (../src/config) — run via ts-node in the builder
# target (design §8.1 fork b'). Byte-identical to the dev `db:seed` script, so
# behavior is provably unchanged. seed.ts is NOT compiled into dist/, NOT modified.
exec pnpm exec ts-node prisma/seed.ts

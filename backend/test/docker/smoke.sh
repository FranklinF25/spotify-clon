#!/usr/bin/env bash
# =============================================================================
# smoke.sh — dockerization integration suite (the 28-scenario red contract).
#
# DOCKER-PR1-03 (BEHAVIOR). This is the strict-TDD red contract for the whole
# dockerization change: design §10.1 realized as a shell compose suite. It
# orchestrates `docker compose down -v` → copy fixture → `up -d` → health-poll
# (≤120s from `up` RETURN, W4) → the curl / openssl s_client / docker exec
# assertion matrix → `down -v`.
#
# 27 of the 28 spec scenarios are automated here. The 28th (SPA <audio> seek,
# REQ-DOCKER-009 "demo loop SPA seek") is a MANUAL reviewer checkpoint
# (CO-DOCKER-1) — Playwright is PRD §11 Phase 2, out of MVP. The HTTP-level
# demo loop (register → login → refresh → browse → search → stream-bytes) IS
# automated in the REQ-009 matrix.
#
# Run: `bash backend/test/docker/smoke.sh` or `make docker-smoke`.
# Exits 0 only when ALL assertions pass.
#
# Deterministic seed constants (seed.ts mulberry32 SEED = 0xc4a10ca7). The
# first seeded album/track have FIXED ids — the fixture is copied to exactly
# that host path before `up` so the REQ-006 Range→206 scenario has a present
# file. Computed once from the PRNG; no runtime discovery needed.
# =============================================================================
set -euo pipefail

FIRST_ALBUM_ID="1567db9a-5c8f-4a37-910a-0c1f04585139"
FIRST_TRACK_ID="e062632f-447d-457e-a209-94e0d0019efe"
FIXTURE_SRC="$(cd "$(dirname "$0")/../fixtures/audio" && pwd)/sample.mp3"
AUDIO_DIR="$(pwd)/audio"
AUDIO_TRACK_DIR="$AUDIO_DIR/$FIRST_ALBUM_ID"
AUDIO_TRACK_FILE="$AUDIO_TRACK_DIR/$FIRST_TRACK_ID.mp3"

# COMPOSE is an ARRAY (not a quoted string) so each call site expands to two
# distinct argv words ("docker" "compose"). A quoted scalar like
# COMPOSE="docker compose" used as "$COMPOSE" would collapse to a single
# "docker compose" token and bash would look for a binary literally named
# "docker compose" → exit 127.
COMPOSE=(docker compose)
DB_C="spotify-clon-db"
BACKEND_C="spotify-clon-backend"
FRONTEND_C="spotify-clon-frontend"
MIGRATE_C="spotify-clon-migrate"
SEED_C="spotify-clon-seed"
BASE_URL="https://localhost"

# Counters for the final summary.
PASS_COUNT=0
FAIL_COUNT=0

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
say()  { printf '%s\n' "$*"; }
pass() { say "[PASS] $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { say "[FAIL] $*" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); exit 1; }

# assert_eq <actual> <expected> <description>
assert_eq() {
  local actual="$1" expected="$2" desc="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$desc (got: $actual)"
  else
    fail "$desc — expected [$expected], got [$actual]"
  fi
}

# assert_contains <haystack> <needle> <description>
assert_contains() {
  local haystack="$1" needle="$2" desc="$3"
  if printf '%s' "$haystack" | grep -qi -- "$needle"; then
    pass "$desc"
  else
    fail "$desc — needle [$needle] not found in output"
  fi
}

# assert_not_contains <haystack> <needle> <description>
assert_not_contains() {
  local haystack="$1" needle="$2" desc="$3"
  if printf '%s' "$haystack" | grep -qi -- "$needle"; then
    fail "$desc — unexpected needle [$needle] found in output"
  else
    pass "$desc"
  fi
}

# http <curl-args...> — echoes "<status>\n<body>"; TLS is self-signed (-k).
http() { curl -k -s -o /tmp/smoke_body.$$ -w '%{http_code}' "$@"; }

# wait_healthy <container> <seconds> — poll the healthcheck status.
wait_healthy() {
  local container="$1" deadline=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local st
    st="$(docker inspect --type container --format '{{.State.Health.Status}}' "$container" 2>/dev/null | tr -d '[:space:]' || echo none)"
    if [ "$st" = "healthy" ]; then return 0; fi
    sleep 2
  done
  return 1
}

# count_rows <table> — psql count via the db container. Returns "0" when the
# table is missing (schema not migrated) or the query errors, so the
# poisoned-migrate phase can assert "0 rows" cleanly.
count_rows() {
  local table="$1" out
  out="$(docker exec "$DB_C" psql -U postgres -d spotify_clone -tAc "SELECT count(*) FROM \"$table\";" 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$out" ]; then echo 0; else echo "$out"; fi
}

# wait_seed_done <seconds> — poll the seed container until it has truly FINISHED
# with exit 0, bounded by <seconds>. MUST gate every count_rows read (W4):
# backend + seed start in parallel after migrate, so reading counts the moment
# the three healthchecks turn green can race a seed still mid-run (cold ts-node
# start + 40-row transaction) → spurious "did not seed". ExitCode alone is NOT a
# safe signal: a not-yet-started (`created`) or `running` container reports
# ExitCode 0, so we additionally require Status == `exited`.
wait_seed_done() {
  local deadline=$((SECONDS + $1)) st rc
  while [ "$SECONDS" -lt "$deadline" ]; do
    st="$(docker inspect --type container --format '{{.State.Status}}' "$SEED_C" 2>/dev/null | tr -d '[:space:]' || echo unknown)"
    rc="$(docker inspect --type container --format '{{.State.ExitCode}}' "$SEED_C" 2>/dev/null | tr -d '[:space:]' || echo unknown)"
    if [ "$st" = "exited" ] && [ "$rc" = "0" ]; then return 0; fi
    sleep 2
  done
  return 1
}

cleanup() {
  local rc=$?
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  rm -rf "$AUDIO_TRACK_DIR" 2>/dev/null || true
  rm -f /tmp/smoke_body.$$ /tmp/smoke_poison.yml.$$ 2>/dev/null || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

# =============================================================================
# Phase A — poisoned-migrate gate (REQ-DOCKER-003 scenario 2)
# A failed migrate MUST block backend + seed (service_completed_successfully).
# Tested by overriding migrate's command to force exit 1 — deterministic and
# fast; it exercises exactly the dependency gate (no DNS/DB flakiness).
# =============================================================================
say "=== Phase A: REQ-DOCKER-003 poisoned-migrate gate ==="
"${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
cat > /tmp/smoke_poison.yml.$$ <<'YAML'
services:
  migrate:
    command: ["sh", "-c", "echo '[migrate] forced failure (poisoned smoke run)' >&2; exit 1"]
YAML
# W1 fix: bring up the FULL stack under the poisoned override, NOT just
# `db migrate`. The old `up -d db migrate` only requested two services —
# backend/seed are downstream and were NEVER requested, so they were trivially
# "absent" and the assertions passed regardless of whether the DAG gate
# (depends_on migrate: service_completed_successfully) actually gates anything.
# The full stack CREATES backend+seed; the gate then HOLDS them in `created`
# (requested but never started) because the poisoned migrate exited 1. A BROKEN
# gate (no depends_on) would let backend reach `running` — that is exactly the
# failure this assertion must catch.
"${COMPOSE[@]}" -f docker-compose.yml -f /tmp/smoke_poison.yml.$$ up -d >/dev/null 2>&1 || true
# Give migrate time to run and fail; db time to come up. backend+seed are held
# in `created` waiting on the (now-unsatisfiable) migrate-success condition.
sleep 15
# backend was REQUESTED (exists) but MUST NOT be `running` — migrate failed, so
# the service_completed_successfully gate is unsatisfiable. `created` is the
# working-gate signature; `running` would mean a BROKEN gate (the vacuous-pass
# case); `absent` would mean the full stack was not requested (test setup bug).
BACKEND_STATE="$(docker inspect --type container --format '{{.State.Status}}' "$BACKEND_C" 2>/dev/null | tr -d '[:space:]' || echo absent)"
case "$BACKEND_STATE" in
  created|paused)
    pass "REQ-003: failed migrate holds backend in '$BACKEND_STATE' (DAG gate holds — not running)"
    ;;
  running)
    fail "REQ-003: backend reached 'running' despite failed migrate — DAG gate BROKEN (state=$BACKEND_STATE)"
    ;;
  absent|"")
    fail "REQ-003: backend container absent — full stack was not requested under the poison (state='$BACKEND_STATE')"
    ;;
  *)
    fail "REQ-003: backend state='$BACKEND_STATE' unexpected (expected created, NOT running/absent)"
    ;;
esac
# seed is gated by the same migrate condition → also held in `created`, never ran.
SEED_STATE="$(docker inspect --type container --format '{{.State.Status}}' "$SEED_C" 2>/dev/null | tr -d '[:space:]' || echo absent)"
if [ "$SEED_STATE" = "created" ] || [ "$SEED_STATE" = "paused" ]; then
  pass "REQ-003: failed migrate holds seed in '$SEED_STATE' (DAG gate holds — seed never ran)"
else
  fail "REQ-003: seed state='$SEED_STATE' — expected created (gated by failed migrate), not running"
fi
# artists=0 is now a MEANINGFUL consequence (seed never executed because the gate
# held it), NOT a trivial one (previously seed was never even requested). The
# schema is also unmigrated (migrate failed), so count_rows safely returns 0.
SEED_RAN_ROWS="$(count_rows artists 2>/dev/null || echo 0)"
assert_eq "$SEED_RAN_ROWS" "0" "REQ-003: failed migrate blocks seed (artists=0, seed never ran)"
"${COMPOSE[@]}" -f docker-compose.yml -f /tmp/smoke_poison.yml.$$ down -v >/dev/null 2>&1 || true
rm -f /tmp/smoke_poison.yml.$$

# =============================================================================
# Phase B — cold start (REQ-001/003/004/011) + the full assertion matrix
# =============================================================================
say "=== Phase B: cold start + healthy steady state ==="

# REQ-009/006 prep: copy the deterministic fixture so the stream scenario has a
# present file (CO-DOCKER-3 — ./audio/ is reviewer-supplied; the suite seeds
# ONLY this deterministic track). Use a sub-path that won't clobber real audio.
mkdir -p "$AUDIO_TRACK_DIR"
cp "$FIXTURE_SRC" "$AUDIO_TRACK_FILE"

# REQ-001: single command, no --profile. `up -d` builds + starts all 5 services.
UP_START="$SECONDS"
"${COMPOSE[@]}" up -d >/dev/null 2>&1
UP_RETURN="$SECONDS"
say "compose up -d returned (build excluded from the cold-start window per W4)."

# REQ-001 scenario 2: cold start reaches steady state ≤120s from `up` RETURN.
# W2 fix: a SHARED aggregate deadline, NOT a per-service 120s budget. The old
# `wait_healthy "$c" 120` loop gave each service its own 120s window counted from
# when the PREVIOUS service turned healthy, so the aggregate could reach ~360s
# while every per-service check "passed" (and UP_RETURN was captured but never
# used). UP_RETURN now anchors a single 120s deadline; the poll fails the moment
# ANY service is still not healthy past it.
COLD_DEADLINE=$((UP_RETURN + 120))
while [ "$SECONDS" -lt "$COLD_DEADLINE" ]; do
  all_healthy=yes
  for c in "$DB_C" "$BACKEND_C" "$FRONTEND_C"; do
    st="$(docker inspect --type container --format '{{.State.Health.Status}}' "$c" 2>/dev/null | tr -d '[:space:]' || echo none)"
    [ "$st" = "healthy" ] || all_healthy=no
  done
  [ "$all_healthy" = "yes" ] && break
  sleep 2
done
COLD_ELAPSED=$((SECONDS - UP_RETURN))
for c in "$DB_C" "$BACKEND_C" "$FRONTEND_C"; do
  st="$(docker inspect --type container --format '{{.State.Health.Status}}' "$c" 2>/dev/null | tr -d '[:space:]' || echo none)"
  assert_eq "$st" "healthy" "REQ-001: $c healthy (cold start ${COLD_ELAPSED}s ≤ 120s aggregate from up RETURN)"
done

# REQ-001 scenario 1: default up lists db/backend/frontend as healthy.
for c in "$DB_C" "$BACKEND_C" "$FRONTEND_C"; do
  st="$(docker inspect --type container --format '{{.State.Health.Status}}' "$c" 2>/dev/null | tr -d '[:space:]' || echo none)"
  assert_eq "$st" "healthy" "REQ-001: $c reports healthy"
done

# /health proxied through nginx over TLS → 200.
code="$(http "$BASE_URL/health")"
assert_eq "$code" "200" "REQ-001/008: GET https://localhost/health → 200"

# REQ-003 scenario 1: migrate completed successfully (exit 0) — by now backend
# is healthy, which is only possible if migrate exited 0 (dependency gate).
MIG_RC="$(docker inspect --type container --format '{{.State.ExitCode}}' "$MIGRATE_C" 2>/dev/null | tr -d '[:space:]' || echo unknown)"
assert_eq "$MIG_RC" "0" "REQ-003/004: migrate exited 0 (gated backend+seed)"

# REQ-004 scenario 1: cold start applied migrations.
MIG_LOGS="$("${COMPOSE[@]}" logs migrate 2>/dev/null || true)"
assert_contains "$MIG_LOGS" "applied" "REQ-004: migrate logs 'applied' on cold start"

# REQ-005 scenario 1: cold start seeded (0 → >0).
# W4: gate the count read on the seed container actually finishing — seed starts
# in parallel with backend after migrate, so reading counts the instant the
# healthchecks turn green can race a seed still mid-run → spurious "did not seed".
if wait_seed_done 60; then
  pass "REQ-005: seed container exited 0 before count read (race window closed)"
else
  fail "REQ-005: seed did not reach exited/0 within 60s — race window unbounded"
fi
ARTISTS_AFTER="$(count_rows artists)"
TRACKS_AFTER="$(count_rows tracks)"
if [ "$ARTISTS_AFTER" -gt 0 ] && [ "$TRACKS_AFTER" -gt 0 ]; then
  pass "REQ-005: cold start seeded (artists=$ARTISTS_AFTER tracks=$TRACKS_AFTER)"
else
  fail "REQ-005: cold start did not seed (artists=$ARTISTS_AFTER tracks=$TRACKS_AFTER)"
fi

# REQ-007 scenario 3: backend boots clean — no superRefine fail-fast.
BACKEND_LOGS="$("${COMPOSE[@]}" logs backend 2>/dev/null || true)"
assert_not_contains "$BACKEND_LOGS" "Invalid environment configuration" \
  "REQ-007: backend boots clean (no superRefine fail-fast)"

# -----------------------------------------------------------------------------
# REQ-002 — TLS termination + redirect + cert + protocol versions + no HSTS
# -----------------------------------------------------------------------------
say "=== Phase B: REQ-002 TLS / redirect / cert / protocols ==="

# Scenario 1: HTTP → 301 HTTPS.
http_plain="$(curl -s -o /dev/null -w '%{http_code}\n%{redirect_url}' http://localhost/health)"
plain_code="$(printf '%s' "$http_plain" | sed -n '1p')"
plain_loc="$(printf '%s' "$http_plain" | sed -n '2p')"
assert_eq "$plain_code" "301" "REQ-002: http://localhost/health → 301"
assert_contains "$plain_loc" "https://" "REQ-002: 301 Location targets https"

# Scenario 2: HTTPS serves the SPA over TLS.
code="$(http "$BASE_URL/")"
assert_eq "$code" "200" "REQ-002: https://localhost/ → 200"
assert_contains "$(cat /tmp/smoke_body.$$)" '<div id="root"' "REQ-002: SPA root element served over TLS"

# Scenario 3: cert CN + SAN.
cert_info="$(echo | openssl s_client -connect localhost:443 -servername localhost 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName 2>/dev/null || true)"
assert_contains "$cert_info" "CN=localhost" "REQ-002: cert CN=localhost"
assert_contains "$cert_info" "DNS:localhost" "REQ-002: cert SAN contains DNS:localhost"
assert_contains "$cert_info" "127.0.0.1" "REQ-002: cert SAN contains IP:127.0.0.1"

# Scenario 4: TLS 1.1 refused, 1.2 negotiated.
# W3 fix: on openssl ≥3.x (this host is 3.5.x) `-tls1_1` fails CLIENT-SIDE at
# security level 1 ("no protocols available") before ever sending a ClientHello,
# so nginx is never probed and the refusal was vacuously "proven". Lowering the
# cipher security level forces the client to actually emit a TLS 1.1 ClientHello,
# so the handshake outcome now reflects nginx's `ssl_protocols TLSv1.2 TLSv1.3`
# refusal (nginx.conf:22) — the thing under test. If nginx were misconfigured to
# permit 1.1, this handshake would now SUCCEED and the assertion would FAIL.
if echo | openssl s_client -connect localhost:443 -tls1_1 -cipher 'DEFAULT:@SECLEVEL=0' >/dev/null 2>&1; then
  fail "REQ-002: TLS 1.1 was accepted (must be refused)"
else
  pass "REQ-002: TLS 1.1 refused (client forced SECLEVEL=0 → nginx refusal is what's tested)"
fi
if echo | openssl s_client -connect localhost:443 -tls1_2 >/dev/null 2>&1; then
  pass "REQ-002: TLS 1.2 negotiated"
else
  fail "REQ-002: TLS 1.2 not negotiated"
fi

# Scenario 5: no HSTS.
hsts_headers="$(curl -k -s -I "$BASE_URL/" 2>/dev/null || true)"
assert_not_contains "$hsts_headers" "Strict-Transport-Security" "REQ-002: no HSTS header"

# -----------------------------------------------------------------------------
# REQ-008 — proxy path preservation (no trailing slash)
# -----------------------------------------------------------------------------
say "=== Phase B: REQ-008 proxy path preservation ==="
# /api/v1 path reaches the backend unchanged. A GET to the guarded /me route
# WITHOUT a token returns 401 (JwtAuthGuard) — proving the path reached the
# backend intact. A trailing slash would rewrite /api/v1/me → /v1/me → 404.
code="$(http "$BASE_URL/api/v1/me")"
assert_eq "$code" "401" "REQ-008: /api/v1/me reaches backend (401, path intact — not 404)"
code="$(http "$BASE_URL/health")"
assert_eq "$code" "200" "REQ-008: /health proxied to backend"

# -----------------------------------------------------------------------------
# REQ-007 — production cookie posture over HTTPS
# -----------------------------------------------------------------------------
say "=== Phase B: REQ-007 cookie posture + refresh round-trip ==="
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
PASS='Smoke-Password-123!'
JAR="$(mktemp)"
# Register a fresh user (unique per run — no collision on re-runs).
reg_code="$(http -c "$JAR" -X POST "$BASE_URL/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"displayName\":\"Smoke User\"}")"
assert_eq "$reg_code" "201" "REQ-009: POST /api/v1/auth/register → 2xx"

# Login stores a Secure refresh cookie.
login_out="$(curl -k -s -i -c "$JAR" -X POST "$BASE_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")"
login_code="$(printf '%s' "$login_out" | awk 'NR==1{print $2}')"
if [ "$login_code" -ge 200 ] && [ "$login_code" -lt 300 ]; then
  pass "REQ-007/009: POST /api/v1/auth/login → 2xx ($login_code)"
else
  fail "REQ-007/009: POST /api/v1/auth/login → $login_code (expected 2xx)"
fi
set_cookie_hdr="$(printf '%s' "$login_out" | grep -i '^set-cookie:' || true)"
assert_contains "$set_cookie_hdr" "Secure" "REQ-007: Set-Cookie carries Secure"
assert_contains "$set_cookie_hdr" "SameSite=Lax" "REQ-007: Set-Cookie carries SameSite=Lax"
assert_contains "$set_cookie_hdr" "Path=/api/v1/auth" "REQ-007: Set-Cookie carries Path=/api/v1/auth"

# Refresh round-trips through nginx (cookie auto-attached, same-origin).
# Note: the Bearer-authed scenarios below use $NEW_TOKEN (from THIS refresh),
# NOT the login accessToken — so the login accessToken is deliberately not
# captured here (it was a dead variable; removed in S2 cleanup).
refresh_out="$(curl -k -s -i -b "$JAR" -c "$JAR" -X POST "$BASE_URL/api/v1/auth/refresh")"
refresh_code="$(printf '%s' "$refresh_out" | awk 'NR==1{print $2}')"
assert_eq "$refresh_code" "200" "REQ-007: POST /api/v1/auth/refresh → 200"
NEW_TOKEN="$(printf '%s' "$refresh_out" | sed -n 's/.*"accessToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
# Rotation signal: compare the REFRESH-token cookies (single-session rotation
# issues a new refresh token with a fresh jti each call). We deliberately do NOT
# compare the access tokens: short-lived access JWTs are deterministic HMACs of
# (sub, iat, exp), so a login + refresh issued in the same wall-clock second
# produce a byte-identical access token even though rotation succeeded. The
# refresh-cookie jti always rotates, so it is the reliable contract signal.
LOGIN_RT="$(printf '%s' "$login_out" | sed -n 's/.*refreshToken=\([^;]*\).*/\1/p' | head -n1)"
REFRESH_RT="$(printf '%s' "$refresh_out" | sed -n 's/.*refreshToken=\([^;]*\).*/\1/p' | head -n1)"
if [ -n "$NEW_TOKEN" ] && [ -n "$REFRESH_RT" ] && [ "$REFRESH_RT" != "$LOGIN_RT" ]; then
  pass "REQ-007/009: refresh rotated the refresh cookie + returned an accessToken"
else
  fail "REQ-007/009: refresh did not return a new accessToken"
fi

# -----------------------------------------------------------------------------
# REQ-009 — demo loop (HTTP-level) over the archived catalog/playback contracts
# -----------------------------------------------------------------------------
say "=== Phase B: REQ-009 demo loop (HTTP-level) ==="
AUTH=(-H "Authorization: Bearer $NEW_TOKEN")

# Browse: album detail embeds tracks.
code="$(http "${AUTH[@]}" "$BASE_URL/api/v1/albums/$FIRST_ALBUM_ID")"
assert_eq "$code" "200" "REQ-009: GET /api/v1/albums/:id → 200"
code="$(http "${AUTH[@]}" "$BASE_URL/api/v1/tracks/$FIRST_TRACK_ID")"
assert_eq "$code" "200" "REQ-009: GET /api/v1/tracks/:id → 200"

# Search returns grouped results.
code="$(http "${AUTH[@]}" "$BASE_URL/api/v1/search?q=Track")"
assert_eq "$code" "200" "REQ-009: GET /api/v1/search?q= → 200"

# -----------------------------------------------------------------------------
# REQ-006 — Range streams bytes (file present); missing file → 404 envelope
# -----------------------------------------------------------------------------
say "=== Phase B: REQ-006 audio Range streaming ==="
code="$(curl -k -s "${AUTH[@]}" -H 'Range: bytes=0-1023' \
  -o /tmp/smoke_stream.$$ -w '%{http_code}' \
  "$BASE_URL/api/v1/tracks/$FIRST_TRACK_ID/stream")"
assert_eq "$code" "206" "REQ-006: Range → 206 Partial Content"
BYTES_GOT="$(wc -c < /tmp/smoke_stream.$$ | tr -d '[:space:]')"
assert_eq "$BYTES_GOT" "1024" "REQ-006: 1024 bytes streamed (Range 0-1023)"

# Scenario 2: file missing → 404 + NOT_FOUND envelope (behavior preserved).
rm -f "$AUDIO_TRACK_FILE"
code="$(http "${AUTH[@]}" "$BASE_URL/api/v1/tracks/$FIRST_TRACK_ID/stream")"
assert_eq "$code" "404" "REQ-006: missing file → 404"
assert_contains "$(cat /tmp/smoke_body.$$)" "NOT_FOUND" "REQ-006: 404 carries NOT_FOUND envelope"
# Restore the fixture so later volume-lifecycle phases still see it if needed.
cp "$FIXTURE_SRC" "$AUDIO_TRACK_FILE"

# -----------------------------------------------------------------------------
# REQ-011 — multi-stage image correctness
# -----------------------------------------------------------------------------
say "=== Phase B: REQ-011 multi-stage image correctness ==="
# Backend /health 200 in-stack (argon2 + prisma load on boot) — already proven
# by the health-poll + the authenticated requests above (argon2 hashed on
# register/login). Re-assert the explicit /health endpoint.
code="$(http "$BASE_URL/health")"
assert_eq "$code" "200" "REQ-011: backend serves /health 200 in-stack"

# Frontend: no node process; index served over :443.
# `grep -c` prints the count AND exits 1 when the count is 0, so a trailing
# `|| echo 0` would double-print ("0\n0"). Use `|| true` inside the pipe so the
# single grep count line is the only output; the OUTER `|| echo 0` still covers
# a docker-exec failure.
FE_PIDS="$(docker exec "$FRONTEND_C" sh -c 'ps -o comm= -A 2>/dev/null | grep -c "^node$" || true' 2>/dev/null | tr -d '[:space:]' || echo 0)"
assert_eq "$FE_PIDS" "0" "REQ-011: no node process in frontend runtime"
code="$(http "$BASE_URL/")"
assert_eq "$code" "200" "REQ-011: frontend serves index over TLS"

# =============================================================================
# Phase C — REQ-004 scenario 2 + REQ-005 scenario 2/3 + REQ-010 volume lifecycle
# =============================================================================
say "=== Phase C: volume lifecycle + seed idempotency ==="

# Capture the cold-seeded baseline counts.
BASE_ARTISTS="$ARTISTS_AFTER"
BASE_TRACKS="$TRACKS_AFTER"

# REQ-004 scenario 2: re-run migrate is a no-op that exits 0.
# REQ-005 scenario 2: warm restart (down WITHOUT -v) skips seeding, counts unchanged.
"${COMPOSE[@]}" down >/dev/null 2>&1
"${COMPOSE[@]}" up -d >/dev/null 2>&1
for c in "$DB_C" "$BACKEND_C" "$FRONTEND_C"; do
  wait_healthy "$c" 120 || fail "REQ-005: $c not healthy on warm restart"
done
MIG_LOGS_2="$("${COMPOSE[@]}" logs migrate 2>/dev/null || true)"
assert_contains "$MIG_LOGS_2" "already applied\|No pending" "REQ-004: re-run migrate is a no-op"
SEED_LOGS_2="$("${COMPOSE[@]}" logs seed 2>/dev/null || true)"
assert_contains "$SEED_LOGS_2" "skipping" "REQ-005: warm restart seed logs 'skipping'"
# W4: gate the warm-restart count read on seed finishing (skip path also exits 0).
wait_seed_done 60 || fail "REQ-005: seed did not reach exited/0 within 60s on warm restart"
WARM_ARTISTS="$(count_rows artists)"
WARM_TRACKS="$(count_rows tracks)"
assert_eq "$WARM_ARTISTS" "$BASE_ARTISTS" "REQ-005/010: warm restart — artists unchanged"
assert_eq "$WARM_TRACKS" "$BASE_TRACKS" "REQ-005/010: warm restart — tracks unchanged"

# REQ-010 scenario 2 + REQ-005 scenario 3: down -v destroys → next up re-seeds.
"${COMPOSE[@]}" down -v >/dev/null 2>&1
"${COMPOSE[@]}" up -d >/dev/null 2>&1
for c in "$DB_C" "$BACKEND_C" "$FRONTEND_C"; do
  wait_healthy "$c" 120 || fail "REQ-010: $c not healthy after down -v + up"
done
# W4: gate the re-seed count read on seed finishing its re-seed transaction.
wait_seed_done 60 || fail "REQ-010: seed did not reach exited/0 within 60s after down -v + up"
RESET_ARTISTS="$(count_rows artists)"
RESET_TRACKS="$(count_rows tracks)"
if [ "$RESET_ARTISTS" -gt 0 ] && [ "$RESET_TRACKS" -gt 0 ]; then
  pass "REQ-005/010: down -v + up re-seeded (artists=$RESET_ARTISTS tracks=$RESET_TRACKS)"
else
  fail "REQ-005/010: down -v + up did NOT re-seed"
fi
# Re-seeded to the same deterministic baseline (seed is deterministic).
assert_eq "$RESET_ARTISTS" "$BASE_ARTISTS" "REQ-010: re-seed artists == baseline (deterministic)"

# =============================================================================
# Phase D — REQ-009 infra-only diff guard (S2 widened + Amendment 2026-07-08)
# ONE documented exception: backend/src/logger.ts (the @Optional() AppLogger
# DI fix — spec REQ-009 amendment 2026-07-08). The diff under the locked paths
# MUST be at most that single file; anything else fails the regression guard.
# =============================================================================
say "=== Phase D: REQ-009 infra-only diff guard (logger.ts exception) ==="
# Use --name-only (one path per line) instead of --stat: the --stat summary
# line ("N files changed...") contains no filename and would falsely survive a
# path filter. The ONLY permitted path is backend/src/logger.ts (the
# @Optional() AppLogger DI fix — REQ-009 amendment 2026-07-08).
# C1 fix: the repo has NO root `prisma/` — the locked paths live under
# `backend/prisma/`. The original `prisma/...` pathspecs were silent no-ops
# (`git diff --name-only main -- prisma/seed.ts` returns nothing), so the three
# locked path-groups were UN-guarded. Corrected + the whole `backend/prisma`
# directory added so seed.spec.ts (and anything else) is covered too.
DIFF_NAMES="$(git diff --name-only main -- \
  backend/src \
  frontend/src \
  backend/prisma/schema.prisma \
  backend/prisma/migrations \
  backend/prisma/seed.ts \
  backend/prisma \
  backend/package.json \
  frontend/package.json 2>/dev/null || true)"
# Remove the one permitted path (exact, whole-line); anything left is a violation.
VIOLATIONS="$(printf '%s\n' "$DIFF_NAMES" | grep -vxF 'backend/src/logger.ts' || true)"
if [ -z "$VIOLATIONS" ]; then
  if [ -n "$DIFF_NAMES" ]; then
    pass "REQ-009: only backend/src/logger.ts modified (documented @Optional() exception)"
  else
    pass "REQ-009: no application-source diff against main (infra-only)"
  fi
else
  fail "REQ-009: unexpected application-source diff (non-logger.ts):
$VIOLATIONS"
fi

# =============================================================================
# Summary
# =============================================================================
say ""
say "============================================================"
say "smoke.sh: $PASS_COUNT passed, $FAIL_COUNT failed"
say "28th scenario (SPA <audio> seek, CO-DOCKER-1) is a MANUAL"
say "reviewer checkpoint — see README 'Docker demo' section."
say "============================================================"
[ "$FAIL_COUNT" -eq 0 ]

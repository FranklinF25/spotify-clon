# syntax=docker/dockerfile:1
# Frontend Dockerfile — multi-stage: node builder (cert gen + vite build) +
# nginx runtime (baked TLS). DOCKER-PR1-07 (REQ-DOCKER-002 + REQ-DOCKER-011
# frontend — PER-IMAGE verifiable). Design §4 verbatim.
#
# No Node in the runtime image (REQ-DOCKER-011).

# =============================================================================
# Stage 1 — builder (install, cert gen, vite build)
# =============================================================================
FROM node:20.18-bookworm-slim AS builder
WORKDIR /app

# .npmrc carries verify-deps-before-run=false (W1) → suppresses pnpm v10/v11's
# pre-run deps gate that would otherwise block `pnpm run build` (esbuild's
# optional-dep verification) inside the container. pnpm-workspace.yaml carries
# onlyBuiltDependencies:[esbuild,msm] (R2-C4): pnpm 10 denies build scripts by
# default, so without this file esbuild's postinstall is skipped.
COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
# pnpm via npm -g (R2-C3 — not corepack: node:20.18 corepack 0.30 has stale
# signing keys; no packageManager field exists so corepack's value-add is unused).
RUN npm install -g pnpm@10.34.4 \
    && pnpm install --frozen-lockfile

# openssl + ca-certificates installed EXPLICITLY (W3): node:*-bookworm-slim does
# NOT guarantee the openssl CLI on PATH — don't assume "bookworm ships it".
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# Self-signed cert baked at BUILD time (Decision #10). openssl installed above
# (NOT assumed from bookworm), so no apk add openssl on the nginx runtime.
# CN=localhost + SAN localhost/127.0.0.1 → the browser warning is about trust,
# never hostname mismatch. days=397 (browsers reject >398).
RUN mkdir -p /certs && \
    openssl req -x509 -nodes -days 397 -newkey rsa:2048 \
      -keyout /certs/localhost.key -out /certs/localhost.crt \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

RUN pnpm run build              # tsc && vite build → dist/

# =============================================================================
# Stage 2 — runtime: nginx:1.27-alpine (S3 — also satisfies http2 on; ≥1.25.1)
# =============================================================================
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /certs/localhost.crt /etc/nginx/certs/localhost.crt
# Private key locked to 0400 (S1) — root-readable only; nginx master runs as
# root and drops privileges in workers. The public cert stays default (0644).
# --chmod needs BuildKit, enabled by the `# syntax=docker/dockerfile:1` directive
# at the top of this file (default in modern Docker).
COPY --chmod=0400 --from=builder /certs/localhost.key /etc/nginx/certs/localhost.key
EXPOSE 80 443
# Healthcheck hits :443 directly over TLS with --no-check-certificate (bypasses
# the self-signed trust step) and pins the IPv4 loopback 127.0.0.1 (R2-C1 — NOT
# localhost): busybox wget resolves localhost IPv6-first to [::1] but nginx's
# `listen 443 ssl;` binds IPv4-only (0.0.0.0:443) → a localhost probe gets
# Connection refused → frontend stays unhealthy forever. The IPv4 pin is the
# load-bearing part of "deterministic".
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -q -O- --no-check-certificate https://127.0.0.1/ >/dev/null 2>&1 || exit 1

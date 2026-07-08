# syntax=docker/dockerfile:1
# Backend Dockerfile — multi-stage, TWO usable targets (DOCKER-PR1-05).
#
#   builder  : full deps + build tools — reused by the `migrate` + `seed`
#              one-shot services (they need the prisma CLI + ts-node + src/).
#   runtime  : clean prod serving image — `node dist/main.js`, no devDeps,
#              no ts-node, no src/.
#
# Base image: node:20.18-bookworm-slim (Debian/glibc) for BOTH stages (S3).
# argon2 ships prebuilt linux-x64 glibc binaries; alpine (musl) would force a
# from-source build in the runtime image (Decision #9, REQ-DOCKER-011).

# =============================================================================
# Stage 1 — builder (migrate/seed toolbox + compile)
# =============================================================================
FROM node:20.18-bookworm-slim AS builder
WORKDIR /app

# Layer-cache: install BEFORE copying src — only re-runs on lockfile change.
# pnpm-workspace.yaml is COPY'd (R2-C4): pnpm 10 denies build scripts by DEFAULT
# and this file's onlyBuiltDependencies allowlist (prisma, @prisma/client,
# @prisma/engines, argon2, esbuild, unrs-resolver) is the ONLY thing letting
# their postinstalls run (prisma generate, argon2 prebuild-fetch). Without it,
# pnpm 10 silently skips them -> no .prisma/client -> backend crashes on boot.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
# pnpm installed via npm -g (R2-C3 — NOT corepack): node:20.18's corepack 0.30
# has stale signing keys that crash `corepack prepare`; the project has no
# packageManager field, so corepack's auto-resolution is unused anyway.
# --node-linker=hoisted (C3): npm-flat layout so @prisma/client + .prisma are
# REAL directories (not symlinks into .pnpm/) — COPY --from=builder dereferences
# symlinks, so the isolated layout would break the runtime overlay.
RUN npm install -g pnpm@10.34.4 \
    && pnpm install --frozen-lockfile --node-linker=hoisted

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# C1 — the seed service runs scripts/seed-with-guard.sh; the wrapper MUST be in
# the image (it lives under scripts/, NOT src/, so it stays outside the
# REQ-009 diff guard).
COPY scripts ./scripts
RUN pnpm run build

# =============================================================================
# Stage 2 — runtime (clean prod serving image)
# =============================================================================
FROM node:20.18-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
# Prod deps only. --ignore-scripts skips the root `postinstall: prisma generate`
# (the prisma CLI is a devDep and absent under --prod, so postinstall would
# fail). We overlay the builder-generated Prisma client below. node-linker=hoisted
# matches the builder (C3) so @prisma/client + .prisma are real dirs the overlay
# can populate. pnpm-workspace.yaml COPY'd for parity (R2-C4).
RUN npm install -g pnpm@10.34.4 \
    && pnpm install --prod --frozen-lockfile --ignore-scripts --node-linker=hoisted
# C2 — --ignore-scripts ALSO skipped argon2's install script (prebuild-install),
# so its prebuilt glibc binary was never fetched. Rebuild ONLY argon2 to fetch
# the binary WITHOUT triggering the absent root postinstall (prisma generate).
RUN pnpm rebuild argon2
# @prisma/client is a devDep -> NOT installed by --prod. Overlay the
# builder-generated client + query engine (same bookworm glibc) so dist/main.js
# -> AppModule -> PrismaModule can import @prisma/client at runtime.
COPY --from=builder /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist

EXPOSE 3000
# HEALTHCHECK values mirror compose (§6 backend.healthcheck), which OVERRIDES
# this at runtime, so compose is authoritative; this Dockerfile value exists
# for standalone `docker run` parity (REQ-DOCKER-011 scenario 1 path).
# start_period=30s matches compose (R2-S1 sync).
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]

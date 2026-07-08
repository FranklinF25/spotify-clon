# Makefile — dockerization canonical entrypoints (DOCKER-PR1-04, design §10.2).
#
# `make docker-smoke` is the one-command integration gate (the 28-scenario red
# contract in backend/test/docker/smoke.sh). The convenience targets mirror the
# documented reviewer workflow (README "Docker demo").

.PHONY: docker-smoke docker-up docker-down docker-reset

# The canonical suite runner. Exits non-zero if any of the 27 automated
# scenarios fail (the 28th, SPA seek, is a manual CO-DOCKER-1 checkpoint).
docker-smoke:
	bash backend/test/docker/smoke.sh

# Build (if needed) and start the full 5-service stack in the background.
docker-up:
	docker compose up -d --build

# Stop the stack but preserve the db_data volume (seeded data survives).
docker-down:
	docker compose down

# Full reset: destroy db_data so the next `up` is a clean cold start + re-seed.
docker-reset:
	docker compose down -v

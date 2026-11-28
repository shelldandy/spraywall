#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
SEED_DIR="$ROOT_DIR/testdata/seed"

if [[ ! -f .env ]]; then
    echo "Missing .env; run 'make setup' first." >&2
    exit 1
fi
if [[ ! -s "$SEED_DIR/db.sql.gz" ]] || ! gzip -t "$SEED_DIR/db.sql.gz"; then
    echo "Missing or invalid database fixture: testdata/seed/db.sql.gz" >&2
    exit 1
fi
if [[ -z "$(find "$SEED_DIR/minio" -type f ! -name .minio-sync.json -print -quit 2>/dev/null)" ]]; then
    echo "Missing MinIO fixture files in testdata/seed/minio/." >&2
    exit 1
fi
if ! command -v mise >/dev/null 2>&1; then
    echo "mise is required; install mise and run 'mise install'." >&2
    exit 1
fi

$COMPOSE stop server worker
gzip -dc "$SEED_DIR/db.sql.gz" \
    | $COMPOSE exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
mise exec -- uv run --with boto3 python scripts/dev/minio_sync.py restore "$SEED_DIR/minio"
$COMPOSE up -d --wait server worker
make migrate

echo "Development data restored from testdata/seed/."

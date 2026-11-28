#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
SEED_DIR="$ROOT_DIR/testdata/seed"
BACKUP_DIR="$ROOT_DIR/.snapshots/$(date -u +%Y%m%dT%H%M%SZ)"
SCRATCH_DB=spraywall_snapshot
scratch_created=0

if [[ ! -f .env ]]; then
    echo "Missing .env; copy .env.example to .env before snapshotting." >&2
    exit 1
fi
if ! command -v mise >/dev/null 2>&1; then
    echo "mise is required; install mise and run 'mise install'." >&2
    exit 1
fi

cleanup() {
    if (( scratch_created )); then
        $COMPOSE exec -T postgres sh -c 'dropdb --if-exists --force -U "$POSTGRES_USER" spraywall_snapshot' >/dev/null || true
    fi
}
trap cleanup EXIT

mkdir -p .snapshots "$SEED_DIR"
if ! mkdir "$BACKUP_DIR"; then
    echo "Backup directory already exists: $BACKUP_DIR" >&2
    exit 1
fi
echo "Saving unsanitized local backup to $BACKUP_DIR"
$COMPOSE exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip -c > "$BACKUP_DIR/db.sql.gz"
mise exec -- uv run --with boto3 python scripts/dev/minio_sync.py dump "$BACKUP_DIR/minio"

$COMPOSE exec -T postgres sh -c 'dropdb --if-exists --force -U "$POSTGRES_USER" spraywall_snapshot'
scratch_created=1
$COMPOSE exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" spraywall_snapshot'
$COMPOSE exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
    | $COMPOSE exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d spraywall_snapshot'
$COMPOSE exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d spraywall_snapshot' \
    < scripts/dev/sanitize.sql
$COMPOSE exec -T postgres sh -c 'exec pg_dump --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d spraywall_snapshot' \
    | gzip -c > "$SEED_DIR/db.sql.gz"
$COMPOSE exec -T postgres sh -c 'dropdb --if-exists --force -U "$POSTGRES_USER" spraywall_snapshot'
scratch_created=0

mise exec -- uv run --with boto3 python scripts/dev/minio_sync.py dump "$SEED_DIR/minio"
echo "Sanitized fixture written to testdata/seed/ (raw backup: ${BACKUP_DIR#"$ROOT_DIR/"})"

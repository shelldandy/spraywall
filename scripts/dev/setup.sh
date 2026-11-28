#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required; install Docker with the Compose plugin." >&2
    exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is required; install the Docker Compose plugin." >&2
    exit 1
fi
if ! command -v mise >/dev/null 2>&1; then
    echo "mise is required; install it from https://mise.jdx.dev/ and retry." >&2
    exit 1
fi

mise install
if [[ ! -f .env ]]; then
    cp .env.example .env
    echo "Created .env from .env.example; adjust it if needed."
fi

( cd web && mise exec -- npm ci )
mise exec -- uv venv --clear worker/.venv --python 3.12
mise exec -- uv pip install --python worker/.venv/bin/python -r worker/requirements-test.txt
$COMPOSE up -d --build --wait
scripts/dev/seed.sh

echo
printf 'Server:   http://localhost:8080\nWeb app:  http://localhost:5173\nMinIO UI: http://localhost:9001\n\nTest logins (password: spraywall):\n'
printf '  admin@spraywall.test\n  user2@spraywall.test\n  user3@spraywall.test\n  user4@spraywall.test\n  user5@spraywall.test\n'

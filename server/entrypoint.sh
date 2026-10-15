#!/bin/sh
set -e

echo "Running database migrations..."
goose -dir /app/db/migrations postgres "$DATABASE_URL" up

exec server

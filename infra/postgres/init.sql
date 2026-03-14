-- This script runs only on first volume creation.
-- Use `docker compose down -v` to reset.
SELECT 'CREATE DATABASE spraywall'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'spraywall')\gexec

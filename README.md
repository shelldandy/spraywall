# Spraywall

AI-assisted spray wall route setting and climbing app.

## Prerequisites

- Docker & Docker Compose
- Node.js ≥ 18 (for Expo)
- Go ≥ 1.22 (optional, for local dev outside Docker)

## Quick Start

```bash
# Clone and configure
git clone https://github.com/bowlinedandy/spraywall.git
cd spraywall
cp .env.example .env

# Start backend services (Postgres, MinIO, Go server, Python worker)
make dev

# In another terminal — start the Expo app
make expo
```

## Services (dev)

| Service  | URL                    |
| -------- | ---------------------- |
| Server   | http://localhost:8080   |
| Postgres | localhost:5433         |
| MinIO    | http://localhost:9000   |
| MinIO UI | http://localhost:9001   |
| Expo     | http://localhost:8081   |

## Useful Commands

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `make dev`      | Start all backend services           |
| `make expo`     | Start Expo dev server                |
| `make migrate`  | Run database migrations              |
| `make sqlc`     | Generate Go code from SQL queries    |
| `make apiclient`| Generate TypeScript API client types |
| `make clean`    | Stop services and remove volumes     |

> **Note:** `docker compose down -v` (or `make clean`) is required to re-run `infra/postgres/init.sql`.

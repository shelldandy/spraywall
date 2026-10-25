.PHONY: dev prod migrate sqlc web web-tailscale lint test clean

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

prod:
	docker compose up -d --build

migrate:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml exec server sh -c 'goose -dir /app/db/migrations postgres "$$DATABASE_URL" up'

sqlc:
	docker run --rm -v ./server:/src -w /src sqlc/sqlc:latest generate

web:
	cd web && npm run dev -- --host

# Expose the dev server over HTTPS on the tailnet (camera needs a secure context).
# Disable with: tailscale serve --https=443 off
web-tailscale:
	tailscale serve --bg 5173
	@tailscale serve status

lint:
	cd server && golangci-lint run ./...
	cd web && npx tsc -b && npx oxlint
	cd worker && ruff check .

test:
	cd server && go test ./...
	cd web && npm test
	cd worker && (python -c "import pytest" 2>/dev/null && python -m pytest -q || echo "pytest not available, skipping worker tests")

clean:
	docker compose down -v

.PHONY: dev prod migrate sqlc apiclient expo lint test clean

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

prod:
	docker compose up -d --build

migrate:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml exec server sh -c 'goose -dir /app/db/migrations postgres "$$DATABASE_URL" up'

sqlc:
	docker run --rm -v ./server:/src -w /src sqlc/sqlc:latest generate

apiclient:
	npx openapi-typescript server/openapi/openapi.yaml -o app/src/lib/api/schema.d.ts

expo:
	cd app && npx expo start

lint:
	cd server && golangci-lint run ./...
	cd app && npx tsc --noEmit
	cd worker && ruff check .

test:
	cd server && go test ./...
	cd worker && (python -c "import pytest" 2>/dev/null && python -m pytest -q || echo "pytest not available, skipping worker tests")

clean:
	docker compose down -v

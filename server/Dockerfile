# ---- Build stage ----
FROM golang:1.26-alpine AS builder

WORKDIR /app

# Install goose
RUN go install github.com/pressly/goose/v3/cmd/goose@latest

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o /server ./cmd/server

# ---- Dev target ----
FROM golang:1.26-alpine AS dev

WORKDIR /app

RUN go install github.com/pressly/goose/v3/cmd/goose@latest && \
    go install github.com/air-verse/air@latest

COPY go.mod go.sum ./
RUN go mod download

CMD ["air", "-c", ".air.toml"]

# ---- Prod target ----
FROM alpine:3.20 AS prod

WORKDIR /app

COPY --from=builder /go/bin/goose /usr/local/bin/goose
COPY --from=builder /server /usr/local/bin/server
COPY db/migrations ./db/migrations

CMD ["server"]

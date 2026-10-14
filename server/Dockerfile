# ---- Build stage ----
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Pin dev tools to versions compatible with Go 1.25.
RUN go install github.com/pressly/goose/v3/cmd/goose@v3.27.0

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o /server ./cmd/server

# ---- Dev target ----
FROM golang:1.25-alpine AS dev

# Server-side image normalization for HEIC uploads.
RUN apk add --no-cache imagemagick imagemagick-jpeg imagemagick-heic

WORKDIR /app

RUN go install github.com/pressly/goose/v3/cmd/goose@v3.27.0 && \
    go install github.com/air-verse/air@v1.67.1

COPY go.mod go.sum ./
RUN go mod download

CMD ["air", "-c", ".air.toml"]

# ---- Prod target ----
FROM alpine:3.20 AS prod

# Server-side image normalization for HEIC uploads.
RUN apk add --no-cache imagemagick imagemagick-jpeg imagemagick-heic

WORKDIR /app

COPY --from=builder /go/bin/goose /usr/local/bin/goose
COPY --from=builder /server /usr/local/bin/server
COPY db/migrations ./db/migrations

CMD ["server"]

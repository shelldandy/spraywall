-- +goose Up
CREATE TABLE storage_deletions (
    id BIGSERIAL PRIMARY KEY,
    storage_key TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX storage_deletions_due_idx ON storage_deletions (next_attempt_at, id);

-- +goose Down
DROP TABLE storage_deletions;

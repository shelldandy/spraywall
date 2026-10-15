-- +goose Up
ALTER TABLE users
    ADD COLUMN avatar_key        TEXT,
    ADD COLUMN avatar_source     TEXT CHECK (avatar_source IN ('upload', 'oidc')),
    ADD COLUMN avatar_origin_url TEXT;

-- +goose Down
ALTER TABLE users
    DROP COLUMN avatar_origin_url,
    DROP COLUMN avatar_source,
    DROP COLUMN avatar_key;

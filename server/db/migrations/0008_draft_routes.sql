-- +goose Up
ALTER TABLE routes ADD COLUMN status TEXT NOT NULL DEFAULT 'published';

-- +goose Down
ALTER TABLE routes DROP COLUMN status;

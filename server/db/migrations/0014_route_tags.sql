-- +goose Up
ALTER TABLE routes ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE routes DROP COLUMN tags;

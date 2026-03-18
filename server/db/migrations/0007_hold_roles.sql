-- +goose Up
ALTER TABLE routes ADD COLUMN hold_roles JSONB;

-- +goose Down
ALTER TABLE routes DROP COLUMN hold_roles;

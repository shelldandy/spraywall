-- +goose Up
ALTER TABLE routes ADD CONSTRAINT routes_status_check CHECK (status IN ('draft', 'published'));

-- +goose Down
ALTER TABLE routes DROP CONSTRAINT routes_status_check;

-- +goose Up
ALTER TABLE users ADD COLUMN role_lapsed_from user_role;

-- +goose Down
ALTER TABLE users DROP COLUMN role_lapsed_from;

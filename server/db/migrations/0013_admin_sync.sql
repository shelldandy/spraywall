-- +goose Up
-- When an OIDC admin group is configured, admin rights expire unless a recent
-- SSO login re-confirmed group membership.
ALTER TABLE users ADD COLUMN role_synced_at TIMESTAMPTZ;

CREATE INDEX idx_users_lower_email ON users (lower(email));

-- +goose Down
DROP INDEX idx_users_lower_email;
ALTER TABLE users DROP COLUMN role_synced_at;

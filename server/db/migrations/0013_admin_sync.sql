-- +goose Up
-- When an OIDC admin group is configured, admin rights expire unless a recent
-- SSO login re-confirmed group membership.
ALTER TABLE users ADD COLUMN role_synced_at TIMESTAMPTZ;

-- Bumped to invalidate outstanding access tokens for sensitive actions
-- (password changes, account takeover by a verified SSO identity).
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
-- A refresh token is only valid while it matches the user's token_version,
-- so tokens minted by a request racing a revocation are dead on arrival.
ALTER TABLE refresh_tokens ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_users_lower_email ON users (lower(email));

-- +goose Down
DROP INDEX idx_users_lower_email;
ALTER TABLE refresh_tokens DROP COLUMN token_version;
ALTER TABLE users DROP COLUMN token_version;
ALTER TABLE users DROP COLUMN role_synced_at;

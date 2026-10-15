-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE lower(email) = lower(@email::text)
ORDER BY (email = @email::text) DESC, created_at
LIMIT 1;

-- name: CreateUser :one
INSERT INTO users (email, password_hash, display_name, role)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CreateRefreshToken :one
INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetRefreshTokenByHash :one
SELECT * FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now();

-- name: DeleteRefreshToken :exec
DELETE FROM refresh_tokens WHERE id = $1;

-- name: DeleteRefreshTokensByUserID :exec
DELETE FROM refresh_tokens WHERE user_id = $1;

-- name: UpdateUserRole :one
UPDATE users SET role = $2, updated_at = now() WHERE id = $1
RETURNING *;

-- name: UpdateUserDisplayName :one
UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1
RETURNING *;

-- name: UpdateUserPassword :exec
UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1;

-- name: UpdateUserAvatar :one
UPDATE users
SET avatar_key = $2, avatar_source = $3, avatar_origin_url = $4, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: GetUserByIdentity :one
SELECT u.* FROM users u
JOIN user_identities ui ON ui.user_id = u.id
WHERE ui.issuer = $1 AND ui.subject = $2;

-- name: GetIdentityByIssuerSubject :one
SELECT * FROM user_identities WHERE issuer = $1 AND subject = $2;

-- name: CreateUserIdentity :one
INSERT INTO user_identities (user_id, issuer, subject, email)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateUserIdentityEmail :exec
UPDATE user_identities SET email = $2 WHERE id = $1;

-- name: ListUserIdentities :many
SELECT * FROM user_identities WHERE user_id = $1 ORDER BY created_at;

-- name: CountUserIdentities :one
SELECT count(*) FROM user_identities WHERE user_id = $1;

-- name: DeleteUserIdentity :execrows
DELETE FROM user_identities WHERE id = $1 AND user_id = $2;

-- name: GetUserByIDForUpdate :one
SELECT * FROM users WHERE id = $1 FOR UPDATE;

-- name: SyncUserRole :one
UPDATE users SET role = $2, role_synced_at = now(), updated_at = now() WHERE id = $1
RETURNING *;

-- name: DeleteUserIdentitiesByUserID :exec
DELETE FROM user_identities WHERE user_id = $1;

-- name: BumpTokenVersion :one
UPDATE users SET token_version = token_version + 1, updated_at = now() WHERE id = $1
RETURNING *;

-- name: ConsumeRefreshToken :one
DELETE FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now()
RETURNING *;

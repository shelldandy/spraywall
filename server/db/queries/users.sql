-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

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

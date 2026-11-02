-- name: CreateInvite :one
INSERT INTO invites (token, created_by, role, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetInviteByToken :one
SELECT * FROM invites
WHERE token = $1 AND used_at IS NULL AND expires_at > now();

-- name: ConsumeInvite :execrows
UPDATE invites SET used_at = now(), used_by = $2
WHERE id = $1 AND used_at IS NULL AND expires_at > now();

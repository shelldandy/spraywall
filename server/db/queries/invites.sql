-- name: CreateInvite :one
INSERT INTO invites (gym_id, token, created_by, role, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetInviteByToken :one
SELECT i.*, g.name AS gym_name, g.slug AS gym_slug
FROM invites i
JOIN gyms g ON i.gym_id = g.id
WHERE i.token = $1 AND i.used_at IS NULL AND i.expires_at > now();

-- name: UseInvite :exec
UPDATE invites SET used_at = now(), used_by = $2 WHERE id = $1;

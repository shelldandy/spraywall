-- name: CreateGym :one
INSERT INTO gyms (name, slug, owner_id)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetGymBySlug :one
SELECT * FROM gyms WHERE slug = $1;

-- name: ListGymsByUser :many
SELECT g.* FROM gyms g
JOIN gym_members gm ON g.id = gm.gym_id
WHERE gm.user_id = $1
ORDER BY g.name;

-- name: CreateGymMember :exec
INSERT INTO gym_members (gym_id, user_id, role)
VALUES ($1, $2, $3);

-- name: GetGymMember :one
SELECT * FROM gym_members WHERE gym_id = $1 AND user_id = $2;

-- name: ListGymMembers :many
SELECT gm.*, u.email, u.display_name FROM gym_members gm
JOIN users u ON gm.user_id = u.id
WHERE gm.gym_id = $1;

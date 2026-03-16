-- name: CreateRoute :one
INSERT INTO routes (wall_id, wall_image_id, created_by, name, grade, description, hold_ids)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetRouteByID :one
SELECT * FROM routes WHERE id = $1;

-- name: ListRoutesByWall :many
SELECT * FROM routes WHERE wall_id = $1 ORDER BY created_at DESC;

-- name: DeleteRoute :exec
DELETE FROM routes WHERE id = $1;

-- name: CreateSend :one
INSERT INTO sends (route_id, user_id, attempts, notes)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: DeleteSendByUser :exec
DELETE FROM sends WHERE route_id = $1 AND user_id = $2;

-- name: GetSendByUser :one
SELECT * FROM sends WHERE route_id = $1 AND user_id = $2;

-- name: CountSendsByRoute :one
SELECT COUNT(*) FROM sends WHERE route_id = $1;

-- name: ListSendsByUser :many
SELECT s.*, r.name AS route_name, r.grade AS route_grade, w.name AS wall_name
FROM sends s
JOIN routes r ON s.route_id = r.id
JOIN walls w ON r.wall_id = w.id
WHERE s.user_id = $1
ORDER BY s.sent_at DESC;

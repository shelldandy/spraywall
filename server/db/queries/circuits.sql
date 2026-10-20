-- name: CreateCircuit :one
INSERT INTO circuits (wall_id, created_by, name, is_shared) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: GetCircuit :one
SELECT * FROM circuits WHERE id = $1;

-- name: ListCircuits :many
SELECT c.* FROM circuits c WHERE c.wall_id = $1 AND (c.is_shared OR c.created_by = $2) ORDER BY c.created_at DESC;

-- name: UpdateCircuit :one
UPDATE circuits SET name = $2, is_shared = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteCircuit :exec
DELETE FROM circuits WHERE id = $1;

-- name: ReplaceCircuitRoutes :exec
DELETE FROM circuit_routes WHERE circuit_id = $1;

-- name: AppendCircuitRoute :exec
INSERT INTO circuit_routes (circuit_id, route_id, position) VALUES ($1, $2, $3) ON CONFLICT (circuit_id, route_id) DO NOTHING;

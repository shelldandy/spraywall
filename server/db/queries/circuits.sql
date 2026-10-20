-- name: CreateCircuit :one
INSERT INTO circuits (wall_id, created_by, name, is_shared) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: ListVisibleCircuitsByWall :many
SELECT c.*, u.display_name AS creator_name,
       ARRAY(
         SELECT cr.route_id::text FROM circuit_routes cr
         JOIN routes r ON r.id = cr.route_id
         WHERE cr.circuit_id = c.id AND (r.status = 'published' OR r.created_by = sqlc.arg(viewer_id))
         ORDER BY cr.position, cr.route_id
       )::text[] AS route_ids
FROM circuits c JOIN users u ON u.id = c.created_by
WHERE c.wall_id = sqlc.arg(wall_id) AND (c.is_shared OR c.created_by = sqlc.arg(viewer_id))
ORDER BY (c.created_by = sqlc.arg(viewer_id)) DESC, c.name;

-- name: GetCircuitByID :one
SELECT c.*, u.display_name AS creator_name FROM circuits c JOIN users u ON u.id=c.created_by WHERE c.id=$1;

-- name: UpdateCircuit :one
UPDATE circuits SET name = $2, is_shared = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteCircuit :exec
DELETE FROM circuits WHERE id = $1;

-- name: AppendCircuitRoute :exec
INSERT INTO circuit_routes (circuit_id, route_id, position)
SELECT $1, $2, COALESCE(max(position) + 1, 0)
FROM circuit_routes
WHERE circuit_id = $1
ON CONFLICT (circuit_id, route_id) DO NOTHING;

-- name: DeleteCircuitRoutes :exec
DELETE FROM circuit_routes WHERE circuit_id=$1;

-- name: InsertCircuitRoute :exec
INSERT INTO circuit_routes(circuit_id,route_id,position) VALUES($1,$2,$3);

-- name: RemoveCircuitRoute :exec
DELETE FROM circuit_routes WHERE circuit_id=$1 AND route_id=$2;

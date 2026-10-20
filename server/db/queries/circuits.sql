-- name: CreateCircuit :one
INSERT INTO circuits (wall_id, created_by, name, is_shared) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: GetCircuit :one
SELECT * FROM circuits WHERE id = $1;

-- name: ListCircuits :many
SELECT c.* FROM circuits c WHERE c.wall_id = $1 AND (c.is_shared OR c.created_by = $2) ORDER BY c.created_at DESC;

-- name: ListVisibleCircuitsByWall :many
SELECT c.*, u.display_name AS creator_name,
       COALESCE(array_agg(cr.route_id ORDER BY cr.position, cr.route_id) FILTER (WHERE cr.route_id IS NOT NULL AND (r.status = 'published' OR r.created_by = sqlc.arg(viewer_id))), ARRAY[]::uuid[]) AS route_ids
FROM circuits c JOIN users u ON u.id = c.created_by
LEFT JOIN circuit_routes cr ON cr.circuit_id = c.id
LEFT JOIN routes r ON r.id = cr.route_id
WHERE c.wall_id = sqlc.arg(wall_id) AND (c.is_shared OR c.created_by = sqlc.arg(viewer_id))
GROUP BY c.id, u.display_name
ORDER BY (c.created_by = sqlc.arg(viewer_id)) DESC, c.is_shared DESC, c.name;

-- name: GetCircuitByID :one
SELECT c.*, u.display_name AS creator_name FROM circuits c JOIN users u ON u.id=c.created_by WHERE c.id=$1;

-- name: UpdateCircuit :one
UPDATE circuits SET name = $2, is_shared = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteCircuit :exec
DELETE FROM circuits WHERE id = $1;

-- name: ReplaceCircuitRoutes :exec
DELETE FROM circuit_routes WHERE circuit_id = $1;

-- name: AppendCircuitRoute :exec
INSERT INTO circuit_routes (circuit_id, route_id, position) VALUES ($1, $2, $3) ON CONFLICT (circuit_id, route_id) DO NOTHING;

-- name: DeleteCircuitRoutes :exec
DELETE FROM circuit_routes WHERE circuit_id=$1;

-- name: InsertCircuitRoute :exec
INSERT INTO circuit_routes(circuit_id,route_id,position) VALUES($1,$2,$3);

-- name: RemoveCircuitRoute :exec
DELETE FROM circuit_routes WHERE circuit_id=$1 AND route_id=$2;

-- name: NextCircuitRoutePosition :one
SELECT COALESCE(max(position)+1,0)::integer FROM circuit_routes WHERE circuit_id=$1;

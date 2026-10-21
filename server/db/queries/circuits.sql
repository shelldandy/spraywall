-- name: CreateCircuit :one
INSERT INTO circuits (wall_id, created_by, name, color, emoji, is_shared) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

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
UPDATE circuits SET name = $2, color = $3, emoji = $4, is_shared = $5, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteCircuit :exec
DELETE FROM circuits WHERE id = $1;

-- name: AppendCircuitRoute :one
INSERT INTO circuit_routes (circuit_id, route_id, position)
SELECT $1, $2, COALESCE(max(position) + 1, 0)
FROM circuit_routes
WHERE circuit_id = $1
HAVING count(*) < 100 OR EXISTS (
    SELECT 1 FROM circuit_routes WHERE circuit_id = $1 AND route_id = $2
)
ON CONFLICT (circuit_id, route_id) DO UPDATE SET position = circuit_routes.position
RETURNING route_id;

-- name: ListCircuitRoutesForReplacement :many
SELECT cr.route_id, (r.status = 'published' OR r.created_by = sqlc.arg(viewer_id)) AS visible
FROM circuit_routes cr
JOIN routes r ON r.id = cr.route_id
WHERE cr.circuit_id = sqlc.arg(circuit_id)
ORDER BY cr.position, cr.route_id;

-- name: ShiftCircuitRoutePositions :exec
UPDATE circuit_routes SET position = position + sqlc.arg(position_shift)::integer
WHERE circuit_id = sqlc.arg(circuit_id);

-- name: DeleteVisibleCircuitRoutes :exec
DELETE FROM circuit_routes cr
USING routes r
WHERE cr.circuit_id = sqlc.arg(circuit_id)
  AND r.id = cr.route_id
  AND (r.status = 'published' OR r.created_by = sqlc.arg(viewer_id));

-- name: UpdateCircuitRoutePosition :exec
UPDATE circuit_routes SET position = $3 WHERE circuit_id = $1 AND route_id = $2;

-- name: InsertCircuitRoute :exec
INSERT INTO circuit_routes(circuit_id,route_id,position) VALUES($1,$2,$3);

-- name: RemoveCircuitRoute :exec
DELETE FROM circuit_routes WHERE circuit_id=$1 AND route_id=$2;

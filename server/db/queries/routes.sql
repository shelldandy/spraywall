-- name: CreateRoute :one
INSERT INTO routes (wall_id, wall_image_id, created_by, name, grade, description, hold_ids, hold_roles, status, tags)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetRouteByID :one
SELECT * FROM routes WHERE id = $1;

-- name: ListRoutesByWall :many
SELECT * FROM routes WHERE wall_id = $1 AND (status = 'published' OR created_by = $2)
ORDER BY created_at DESC;

-- name: UpdateRoute :one
UPDATE routes SET name = $2, grade = $3, description = $4, hold_ids = $5, hold_roles = $6, tags = $7
WHERE id = $1
RETURNING *;

-- name: UpdateRouteStatus :exec
UPDATE routes SET status = $2 WHERE id = $1;

-- name: DeleteRoute :exec
DELETE FROM routes WHERE id = $1;

-- name: GetRouteLogSummaries :many
SELECT route_id,
       count(*) FILTER (WHERE outcome IN ('send', 'flash'))::bigint AS send_count,
       count(*) FILTER (WHERE user_id = $2 AND outcome = 'attempt')::bigint AS own_attempts,
       count(*) FILTER (WHERE user_id = $2 AND outcome IN ('send', 'flash'))::bigint AS own_successes,
       COALESCE(bool_or(user_id = $2 AND outcome = 'flash'), false)::boolean AS has_flashed
FROM climb_logs WHERE route_id = ANY($1::uuid[]) GROUP BY route_id;

-- name: GetRouteRatingSummaries :many
SELECT route_id, avg(stars)::float8 AS rating_average, count(*)::bigint AS rating_count,
       COALESCE(max(stars) FILTER (WHERE user_id = $2), 0)::integer AS my_rating
FROM route_ratings WHERE route_id = ANY($1::uuid[]) GROUP BY route_id;

-- name: CreateClimbLog :one
INSERT INTO climb_logs (id, route_id, user_id, outcome, climbed_on, notes, attempts)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListClimbLogsByUserRoute :many
SELECT id, route_id, user_id, logged_at, climbed_on, outcome, attempts, notes
FROM climb_logs WHERE user_id = $1 AND route_id = $2
ORDER BY climbed_on, logged_at, id;

-- name: ListUserClimbLogs :many
SELECT l.id, l.route_id, l.user_id, l.logged_at, l.climbed_on, l.outcome, l.attempts, l.notes,
       r.name AS route_name, r.grade AS route_grade, w.id AS wall_id, w.name AS wall_name, w.gym_id, g.slug AS gym_slug
FROM climb_logs l JOIN routes r ON r.id = l.route_id JOIN walls w ON w.id = r.wall_id JOIN gyms g ON g.id = w.gym_id
WHERE l.user_id = $1 ORDER BY l.climbed_on DESC, l.logged_at DESC, l.id DESC;

-- name: LockUserForClimbLogs :one
SELECT id FROM users WHERE id = $1 FOR UPDATE;

-- name: GetClimbLogForUpdate :one
SELECT id, user_id, attempts FROM climb_logs WHERE id = $1 AND route_id = $2;

-- name: UpdateClimbLog :exec
UPDATE climb_logs SET outcome = $3, climbed_on = $4, notes = $5 WHERE id = $1 AND route_id = $2;

-- name: DeleteClimbLog :exec
DELETE FROM climb_logs WHERE id = $1;

-- name: UpsertRouteRating :one
INSERT INTO route_ratings (route_id, user_id, stars) VALUES ($1, $2, $3)
ON CONFLICT (route_id, user_id) DO UPDATE SET stars = EXCLUDED.stars, updated_at = now()
RETURNING *;

-- name: DeleteRouteRating :exec
DELETE FROM route_ratings WHERE route_id = $1 AND user_id = $2;

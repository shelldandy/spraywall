-- name: CreateWall :one
INSERT INTO walls (gym_id, name)
VALUES ($1, $2)
RETURNING *;

-- name: GetWallByID :one
SELECT * FROM walls WHERE id = $1;

-- name: ListWallsByGym :many
SELECT * FROM walls WHERE gym_id = $1 ORDER BY name;

-- name: CreateWallImage :one
INSERT INTO wall_images (wall_id, storage_key)
VALUES ($1, $2)
RETURNING *;

-- name: GetActiveWallImage :one
SELECT * FROM wall_images WHERE wall_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1;

-- name: DeactivateWallImages :exec
UPDATE wall_images SET is_active = false WHERE wall_id = $1;

-- name: CreateDetectionJob :one
INSERT INTO detection_jobs (wall_image_id)
VALUES ($1)
RETURNING *;

-- name: GetDetectionJobByWallImage :one
SELECT * FROM detection_jobs WHERE wall_image_id = $1 ORDER BY created_at DESC LIMIT 1;

-- name: GetHoldsByWallImage :many
SELECT * FROM holds WHERE wall_image_id = $1 ORDER BY confidence DESC;

-- name: CreateHold :one
INSERT INTO holds (wall_image_id, bbox, confidence)
VALUES ($1, $2, $3)
RETURNING *;

-- name: DeleteHold :one
DELETE FROM holds WHERE id = $1 AND wall_image_id = $2 RETURNING id;

-- name: DeleteWall :exec
DELETE FROM walls WHERE id = $1 AND gym_id = $2;

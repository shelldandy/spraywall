-- name: CreateWall :one
INSERT INTO walls (gym_id, name)
VALUES ($1, $2)
RETURNING *;

-- name: GetWallByID :one
SELECT * FROM walls WHERE id = $1;

-- name: ListWallsByGym :many
SELECT
    w.id,
    w.gym_id,
    w.name,
    w.created_at,
    COALESCE(active_image.storage_key, '') AS preview_storage_key
FROM walls w
LEFT JOIN LATERAL (
    SELECT storage_key
    FROM wall_images
    WHERE wall_id = w.id AND is_active = true
    ORDER BY created_at DESC
    LIMIT 1
) active_image ON true
WHERE w.gym_id = $1
ORDER BY w.name;

-- name: CreateWallImage :one
INSERT INTO wall_images (wall_id, storage_key)
VALUES ($1, $2)
RETURNING *;

-- name: CreatePendingResetImage :one
INSERT INTO wall_images (wall_id, storage_key, is_active, parent_image_id, reset_kind, review_status)
VALUES ($1, $2, false, $3, 'partial', 'pending')
RETURNING *;

-- name: GetPendingResetImage :one
SELECT * FROM wall_images WHERE wall_id = $1 AND reset_kind = 'partial' AND review_status = 'pending' ORDER BY created_at DESC LIMIT 1;

-- name: DeletePendingResetImage :one
DELETE FROM wall_images WHERE id = $1 AND reset_kind = 'partial' AND review_status = 'pending' RETURNING storage_key;

-- name: LockWallImagesForReset :many
SELECT id, wall_id, is_active, parent_image_id, review_status FROM wall_images WHERE wall_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE;

-- name: ApplyPendingResetImage :exec
UPDATE wall_images SET is_active = true, review_status = 'applied' WHERE id = $1;


-- name: GetResetMatches :many
SELECT old_hold_id, new_hold_id FROM hold_matches WHERE wall_image_id = $1 ORDER BY old_hold_id;

-- name: DeleteResetMatches :exec
DELETE FROM hold_matches WHERE wall_image_id = $1;

-- name: UpsertResetMatch :exec
INSERT INTO hold_matches (wall_image_id, old_hold_id, new_hold_id, source, iou)
VALUES ($1, $2, $3, $4, NULL)
ON CONFLICT (new_hold_id) DO UPDATE SET old_hold_id = EXCLUDED.old_hold_id, source = EXCLUDED.source;

-- name: DeleteResetMatchByOldHold :exec
DELETE FROM hold_matches WHERE wall_image_id = $1 AND old_hold_id = $2;

-- name: DeleteResetMatchesByNewHold :exec
DELETE FROM hold_matches WHERE wall_image_id = $1 AND new_hold_id = $2;


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

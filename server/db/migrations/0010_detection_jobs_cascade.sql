-- +goose Up
ALTER TABLE detection_jobs DROP CONSTRAINT detection_jobs_wall_image_id_fkey;
ALTER TABLE detection_jobs ADD CONSTRAINT detection_jobs_wall_image_id_fkey
    FOREIGN KEY (wall_image_id) REFERENCES wall_images(id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE detection_jobs DROP CONSTRAINT detection_jobs_wall_image_id_fkey;
ALTER TABLE detection_jobs ADD CONSTRAINT detection_jobs_wall_image_id_fkey
    FOREIGN KEY (wall_image_id) REFERENCES wall_images(id);

-- +goose Up
ALTER TABLE wall_images
    ADD COLUMN parent_image_id UUID NULL REFERENCES wall_images(id) ON DELETE SET NULL,
    ADD COLUMN reset_kind TEXT NOT NULL DEFAULT 'full' CHECK (reset_kind IN ('full', 'partial')),
    ADD COLUMN review_status TEXT NULL CHECK (review_status IN ('pending', 'applied')),
    ADD COLUMN alignment JSONB NULL;

CREATE TABLE hold_matches (
    new_hold_id UUID PRIMARY KEY REFERENCES holds(id) ON DELETE CASCADE,
    old_hold_id UUID NOT NULL UNIQUE REFERENCES holds(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
    iou REAL,
    wall_image_id UUID NOT NULL REFERENCES wall_images(id) ON DELETE CASCADE
);
CREATE INDEX hold_matches_wall_image_id_idx ON hold_matches(wall_image_id);

-- +goose Down
DROP TABLE hold_matches;
ALTER TABLE wall_images
    DROP COLUMN alignment,
    DROP COLUMN review_status,
    DROP COLUMN reset_kind,
    DROP COLUMN parent_image_id;

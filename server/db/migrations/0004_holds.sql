-- +goose Up
CREATE TABLE holds (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wall_image_id UUID NOT NULL REFERENCES wall_images(id) ON DELETE CASCADE,
    bbox          JSONB NOT NULL,
    polygon       JSONB,
    confidence    REAL NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_holds_wall_image_id ON holds(wall_image_id);

-- +goose Down
DROP TABLE holds;

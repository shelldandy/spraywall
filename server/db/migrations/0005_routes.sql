-- +goose Up
CREATE TABLE routes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wall_id       UUID NOT NULL REFERENCES walls(id) ON DELETE CASCADE,
    wall_image_id UUID NOT NULL REFERENCES wall_images(id),
    created_by    UUID NOT NULL REFERENCES users(id),
    name          TEXT NOT NULL,
    grade         TEXT,
    description   TEXT,
    hold_ids      UUID[] NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sends (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INT,
    notes    TEXT,
    UNIQUE (route_id, user_id)
);

-- +goose Down
DROP TABLE sends;
DROP TABLE routes;

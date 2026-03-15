-- +goose Up
CREATE TABLE gyms (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    slug       TEXT UNIQUE NOT NULL,
    owner_id   UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gym_members (
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role   user_role NOT NULL DEFAULT 'climber',
    PRIMARY KEY (gym_id, user_id)
);

CREATE TABLE walls (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id     UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wall_images (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wall_id     UUID NOT NULL REFERENCES walls(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE detection_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wall_image_id UUID NOT NULL REFERENCES wall_images(id),
    status        TEXT NOT NULL DEFAULT 'pending',
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE detection_jobs;
DROP TABLE wall_images;
DROP TABLE walls;
DROP TABLE gym_members;
DROP TABLE gyms;

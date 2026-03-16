-- +goose Up
CREATE TABLE invites (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id     UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    token      TEXT UNIQUE NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    role       user_role NOT NULL DEFAULT 'climber',
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    used_by    UUID REFERENCES users(id)
);

-- +goose Down
DROP TABLE invites;

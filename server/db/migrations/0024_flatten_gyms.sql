-- +goose Up
UPDATE users u
SET role = m.role
FROM (
    SELECT user_id, max(role) AS role
    FROM (
        SELECT user_id, role FROM gym_members
        UNION ALL
        SELECT owner_id, 'admin'::user_role FROM gyms
    ) roles
    GROUP BY user_id
) m
WHERE m.user_id = u.id AND m.role > u.role;

ALTER TABLE invites DROP COLUMN gym_id;
ALTER TABLE walls DROP COLUMN gym_id;
DROP TABLE gym_members;
DROP TABLE gyms;

-- +goose Down
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

INSERT INTO gyms (name, slug, owner_id)
SELECT 'Home', 'home', id
FROM users
ORDER BY (role = 'admin'::user_role) DESC, created_at, id
LIMIT 1;

ALTER TABLE walls ADD COLUMN gym_id UUID;
UPDATE walls SET gym_id = (SELECT id FROM gyms LIMIT 1);
ALTER TABLE walls ALTER COLUMN gym_id SET NOT NULL;
ALTER TABLE walls ADD CONSTRAINT walls_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE;

ALTER TABLE invites ADD COLUMN gym_id UUID;
UPDATE invites SET gym_id = (SELECT id FROM gyms LIMIT 1);
ALTER TABLE invites ALTER COLUMN gym_id SET NOT NULL;
ALTER TABLE invites ADD CONSTRAINT invites_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE CASCADE;

INSERT INTO gym_members (gym_id, user_id, role)
SELECT (SELECT id FROM gyms LIMIT 1), id, role FROM users;

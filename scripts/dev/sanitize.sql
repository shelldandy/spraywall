BEGIN;

-- Replace original addresses before assigning deterministic fixture accounts.
UPDATE users
SET email = id::text || '@snapshot.invalid',
    password_hash = '$2a$12$s08Sfy0ez6S7BHSoYnHTm.Xsy6X/tmnfrkdHeHNf/lMT5dN5xo8nS',
    avatar_key = NULL,
    avatar_source = NULL,
    avatar_origin_url = NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin') THEN
        RAISE EXCEPTION 'Snapshot requires at least one admin user';
    END IF;
END $$;

WITH first_admin AS (
    SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1
), ranked_users AS (
    SELECT u.id,
           row_number() OVER (ORDER BY (u.id = a.id) DESC, u.created_at, u.id) AS position
    FROM users AS u CROSS JOIN first_admin AS a
)
UPDATE users AS u
SET email = CASE WHEN r.position = 1 THEN 'admin@spraywall.test'
                 ELSE format('user%s@spraywall.test', r.position)
            END,
    display_name = CASE WHEN r.position = 1 THEN 'Admin'
                        ELSE format('User %s', r.position)
                   END
FROM ranked_users AS r
WHERE u.id = r.id;

DELETE FROM refresh_tokens;
DELETE FROM user_identities;
DELETE FROM invites;
DELETE FROM storage_deletions;
DELETE FROM beta_videos WHERE source = 'immich';

COMMIT;

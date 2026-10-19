-- +goose Up
ALTER TABLE sends RENAME TO climb_logs;
ALTER TABLE climb_logs RENAME COLUMN sent_at TO logged_at;
ALTER TABLE climb_logs ADD COLUMN outcome TEXT NOT NULL DEFAULT 'send';
ALTER TABLE climb_logs ADD COLUMN climbed_on DATE;
UPDATE climb_logs SET climbed_on = (logged_at AT TIME ZONE 'UTC')::date;
ALTER TABLE climb_logs ALTER COLUMN climbed_on SET NOT NULL;
ALTER TABLE climb_logs ADD CONSTRAINT climb_logs_outcome_check CHECK (outcome IN ('attempt', 'send', 'flash'));
ALTER TABLE climb_logs DROP CONSTRAINT sends_route_id_user_id_key;
CREATE UNIQUE INDEX climb_logs_one_flash_per_user_route ON climb_logs (route_id, user_id) WHERE outcome = 'flash';
CREATE INDEX climb_logs_route_user_date_idx ON climb_logs (route_id, user_id, climbed_on, logged_at, id);
CREATE INDEX climb_logs_user_date_idx ON climb_logs (user_id, climbed_on DESC, logged_at DESC, id DESC);

CREATE TABLE route_ratings (
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (route_id, user_id)
);
CREATE INDEX route_ratings_user_idx ON route_ratings (user_id, route_id);

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM route_ratings) THEN
        RAISE EXCEPTION 'cannot roll back climb logging migration: route ratings would be lost';
    END IF;
    IF EXISTS (SELECT 1 FROM climb_logs WHERE outcome <> 'send') THEN
        RAISE EXCEPTION 'cannot roll back climb logging migration: attempts/flashes would be lost';
    END IF;
    IF EXISTS (SELECT 1 FROM climb_logs WHERE climbed_on <> (logged_at AT TIME ZONE 'UTC')::date) THEN
        RAISE EXCEPTION 'cannot roll back climb logging migration: backdated calendar dates would be lost';
    END IF;
    IF EXISTS (SELECT 1 FROM climb_logs GROUP BY route_id, user_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'cannot roll back climb logging migration: repeat history cannot be represented';
    END IF;
END $$;
-- +goose StatementEnd
DROP INDEX route_ratings_user_idx;
DROP TABLE route_ratings;
DROP INDEX climb_logs_user_date_idx;
DROP INDEX climb_logs_route_user_date_idx;
DROP INDEX climb_logs_one_flash_per_user_route;
ALTER TABLE climb_logs DROP CONSTRAINT climb_logs_outcome_check;
ALTER TABLE climb_logs DROP COLUMN climbed_on;
ALTER TABLE climb_logs DROP COLUMN outcome;
ALTER TABLE climb_logs RENAME COLUMN logged_at TO sent_at;
ALTER TABLE climb_logs RENAME TO sends;
ALTER TABLE sends ADD CONSTRAINT sends_route_id_user_id_key UNIQUE (route_id, user_id);

-- +goose Up
CREATE INDEX climb_logs_route_activity_idx ON climb_logs (route_id, climbed_on DESC, logged_at DESC, id DESC);

-- +goose Down
DROP INDEX climb_logs_route_activity_idx;

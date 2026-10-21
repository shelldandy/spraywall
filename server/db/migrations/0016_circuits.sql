-- +goose Up
CREATE TABLE circuits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wall_id UUID NOT NULL REFERENCES walls(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    is_shared BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX circuits_wall_owner_idx ON circuits(wall_id, created_by);
CREATE TABLE circuit_routes (
    circuit_id UUID NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (circuit_id, route_id),
    UNIQUE (circuit_id, position)
);
CREATE INDEX circuit_routes_route_idx ON circuit_routes(route_id);

-- +goose Down
DROP TABLE circuit_routes;
DROP TABLE circuits;

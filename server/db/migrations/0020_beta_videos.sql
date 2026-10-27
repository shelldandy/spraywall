-- +goose Up
CREATE TABLE beta_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('immich','youtube','instagram','tiktok')),
  url TEXT NOT NULL,
  external_id TEXT,
  climber_handle TEXT,
  immich_base_url TEXT,
  immich_share_key TEXT,
  immich_share_slug TEXT,
  immich_asset_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, url)
);
CREATE INDEX beta_videos_route_idx ON beta_videos (route_id, created_at DESC, id DESC);

-- +goose Down
DROP TABLE beta_videos;

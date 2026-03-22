export const SCHEMA_VERSION = 1;

export const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS gyms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    user_role TEXT
  );

  CREATE TABLE IF NOT EXISTS walls (
    id TEXT PRIMARY KEY,
    gym_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (gym_id) REFERENCES gyms(id)
  );

  CREATE TABLE IF NOT EXISTS wall_images (
    id TEXT PRIMARY KEY,
    wall_id TEXT NOT NULL,
    image_url TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (wall_id) REFERENCES walls(id)
  );

  CREATE TABLE IF NOT EXISTS holds (
    id TEXT PRIMARY KEY,
    wall_image_id TEXT NOT NULL,
    bbox TEXT NOT NULL,
    polygon TEXT,
    confidence REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (wall_image_id) REFERENCES wall_images(id)
  );

  CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    wall_id TEXT NOT NULL,
    wall_image_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    name TEXT NOT NULL,
    grade TEXT,
    description TEXT,
    hold_ids TEXT NOT NULL DEFAULT '[]',
    hold_roles TEXT,
    created_at TEXT NOT NULL,
    send_count INTEGER NOT NULL DEFAULT 0,
    has_sent INTEGER NOT NULL DEFAULT 0,
    is_legacy INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published',
    FOREIGN KEY (wall_id) REFERENCES walls(id)
  );

  CREATE TABLE IF NOT EXISTS sends (
    id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    attempts INTEGER,
    notes TEXT,
    UNIQUE(route_id, user_id),
    FOREIGN KEY (route_id) REFERENCES routes(id)
  );

  CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_mutations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_walls_gym_id ON walls(gym_id);
  CREATE INDEX IF NOT EXISTS idx_wall_images_wall_id ON wall_images(wall_id);
  CREATE INDEX IF NOT EXISTS idx_holds_wall_image_id ON holds(wall_image_id);
  CREATE INDEX IF NOT EXISTS idx_routes_wall_id ON routes(wall_id);
  CREATE INDEX IF NOT EXISTS idx_sends_route_id ON sends(route_id);
  CREATE INDEX IF NOT EXISTS idx_sends_user_id ON sends(user_id);
  CREATE INDEX IF NOT EXISTS idx_pending_mutations_status ON pending_mutations(status);
`;

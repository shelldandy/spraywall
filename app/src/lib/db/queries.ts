import { getDb } from "./database";
import type {
  Gym,
  Wall,
  WallDetail,
  Hold,
  Route,
  LogbookEntry,
} from "../api/types";

// ── Reads ──────────────────────────────────────────────

export function getGyms(): Gym[] {
  return getDb().getAllSync<Gym>("SELECT * FROM gyms ORDER BY created_at DESC");
}

export function getWallsByGymId(gymId: string): Wall[] {
  return getDb().getAllSync<Wall>(
    "SELECT * FROM walls WHERE gym_id = ? ORDER BY created_at DESC",
    gymId,
  );
}

export interface GymWithWalls extends Gym {
  walls: Wall[];
}

export function getGymsWithWalls(): GymWithWalls[] {
  const gyms = getGyms();
  return gyms.map((gym) => ({
    ...gym,
    walls: getWallsByGymId(gym.id),
  }));
}

export function getWallDetail(wallId: string): WallDetail | null {
  const wall = getDb().getFirstSync<Wall>(
    "SELECT * FROM walls WHERE id = ?",
    wallId,
  );
  if (!wall) return null;

  const image = getDb().getFirstSync<{
    id: string;
    image_url: string;
    is_active: number;
    created_at: string;
  }>(
    "SELECT id, image_url, is_active, created_at FROM wall_images WHERE wall_id = ? AND is_active = 1 LIMIT 1",
    wallId,
  );

  const detectionMeta = getDb().getFirstSync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = ?",
    `detection_status:${wallId}`,
  );

  const userRoleMeta = getDb().getFirstSync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = ?",
    `wall_user_role:${wallId}`,
  );

  return {
    wall,
    image: image
      ? {
          id: image.id,
          image_url: image.image_url,
          is_active: !!image.is_active,
          created_at: image.created_at,
        }
      : null,
    detection_status: detectionMeta?.value ?? null,
    user_role: userRoleMeta?.value ?? undefined,
  };
}

export function getHoldsByWallImageId(wallImageId: string): Hold[] {
  const rows = getDb().getAllSync<{
    id: string;
    wall_image_id: string;
    bbox: string;
    polygon: string | null;
    confidence: number;
  }>(
    "SELECT * FROM holds WHERE wall_image_id = ? ORDER BY confidence DESC",
    wallImageId,
  );
  return rows.map((r) => ({
    id: r.id,
    wall_image_id: r.wall_image_id,
    bbox: JSON.parse(r.bbox),
    polygon: r.polygon ? JSON.parse(r.polygon) : null,
    confidence: r.confidence,
  }));
}

export function getHoldsByWallId(wallId: string): Hold[] {
  const image = getDb().getFirstSync<{ id: string }>(
    "SELECT id FROM wall_images WHERE wall_id = ? AND is_active = 1 LIMIT 1",
    wallId,
  );
  if (!image) return [];
  return getHoldsByWallImageId(image.id);
}

export function getRoutesByWallId(wallId: string): Route[] {
  const rows = getDb().getAllSync<{
    id: string;
    wall_id: string;
    wall_image_id: string;
    created_by: string;
    name: string;
    grade: string | null;
    description: string | null;
    hold_ids: string;
    hold_roles: string | null;
    created_at: string;
    send_count: number;
    has_sent: number;
    is_legacy: number;
    status: string;
  }>(
    "SELECT * FROM routes WHERE wall_id = ? ORDER BY created_at DESC",
    wallId,
  );
  return rows.map(parseRouteRow);
}

export function getRouteDetail(routeId: string): Route | null {
  const row = getDb().getFirstSync<{
    id: string;
    wall_id: string;
    wall_image_id: string;
    created_by: string;
    name: string;
    grade: string | null;
    description: string | null;
    hold_ids: string;
    hold_roles: string | null;
    created_at: string;
    send_count: number;
    has_sent: number;
    is_legacy: number;
    status: string;
  }>("SELECT * FROM routes WHERE id = ?", routeId);
  if (!row) return null;
  return parseRouteRow(row);
}

function parseRouteRow(row: {
  id: string;
  wall_id: string;
  wall_image_id: string;
  created_by: string;
  name: string;
  grade: string | null;
  description: string | null;
  hold_ids: string;
  hold_roles: string | null;
  created_at: string;
  send_count: number;
  has_sent: number;
  is_legacy: number;
  status: string;
}): Route {
  return {
    id: row.id,
    wall_id: row.wall_id,
    wall_image_id: row.wall_image_id,
    created_by: row.created_by,
    name: row.name,
    grade: row.grade,
    description: row.description,
    hold_ids: JSON.parse(row.hold_ids),
    hold_roles: row.hold_roles ? JSON.parse(row.hold_roles) : null,
    created_at: row.created_at,
    send_count: row.send_count,
    has_sent: !!row.has_sent,
    is_legacy: !!row.is_legacy,
    status: row.status as "draft" | "published",
  };
}

export function getLogbook(userId: string): LogbookEntry[] {
  return getDb().getAllSync<LogbookEntry>(
    `SELECT s.id, s.route_id, s.user_id, s.sent_at, s.attempts, s.notes,
            r.name AS route_name, r.grade AS route_grade, w.name AS wall_name
     FROM sends s
     JOIN routes r ON r.id = s.route_id
     JOIN walls w ON w.id = r.wall_id
     WHERE s.user_id = ?
     ORDER BY s.sent_at DESC`,
    userId,
  );
}

// ── Upserts ────────────────────────────────────────────

export function upsertGyms(gyms: Gym[]) {
  const db = getDb();
  const stmt = db.prepareSync(
    "INSERT OR REPLACE INTO gyms (id, name, slug, owner_id, created_at, user_role) VALUES (?, ?, ?, ?, ?, ?)",
  );
  try {
    db.execSync("BEGIN TRANSACTION");
    for (const g of gyms) {
      stmt.executeSync(g.id, g.name, g.slug, g.owner_id, g.created_at, g.user_role ?? null);
    }
    db.execSync("COMMIT");
  } catch (e) {
    db.execSync("ROLLBACK");
    throw e;
  } finally {
    stmt.finalizeSync();
  }
}

export function upsertWalls(walls: Wall[]) {
  const db = getDb();
  const stmt = db.prepareSync(
    "INSERT OR REPLACE INTO walls (id, gym_id, name, created_at) VALUES (?, ?, ?, ?)",
  );
  try {
    db.execSync("BEGIN TRANSACTION");
    for (const w of walls) {
      stmt.executeSync(w.id, w.gym_id, w.name, w.created_at);
    }
    db.execSync("COMMIT");
  } catch (e) {
    db.execSync("ROLLBACK");
    throw e;
  } finally {
    stmt.finalizeSync();
  }
}

export function upsertWallImage(image: {
  id: string;
  wall_id: string;
  image_url: string;
  is_active: boolean;
  created_at: string;
}) {
  const db = getDb();
  db.execSync("BEGIN TRANSACTION");
  try {
    // Deactivate other images for this wall if the new one is active
    if (image.is_active) {
      db.runSync(
        "UPDATE wall_images SET is_active = 0 WHERE wall_id = ? AND id != ? AND is_active = 1",
        image.wall_id,
        image.id,
      );
    }
    db.runSync(
      "INSERT OR REPLACE INTO wall_images (id, wall_id, image_url, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
      image.id,
      image.wall_id,
      image.image_url,
      image.is_active ? 1 : 0,
      image.created_at,
    );
    db.execSync("COMMIT");
  } catch (e) {
    db.execSync("ROLLBACK");
    throw e;
  }
}

export function upsertHolds(holds: Hold[]) {
  const db = getDb();
  const stmt = db.prepareSync(
    "INSERT OR REPLACE INTO holds (id, wall_image_id, bbox, polygon, confidence) VALUES (?, ?, ?, ?, ?)",
  );
  try {
    db.execSync("BEGIN TRANSACTION");
    for (const h of holds) {
      stmt.executeSync(
        h.id,
        h.wall_image_id,
        JSON.stringify(h.bbox),
        h.polygon ? JSON.stringify(h.polygon) : null,
        h.confidence,
      );
    }
    db.execSync("COMMIT");
  } catch (e) {
    db.execSync("ROLLBACK");
    throw e;
  } finally {
    stmt.finalizeSync();
  }
}

export function upsertRoutes(routes: Route[]) {
  const db = getDb();
  const stmt = db.prepareSync(
    `INSERT OR REPLACE INTO routes
     (id, wall_id, wall_image_id, created_by, name, grade, description, hold_ids, hold_roles, created_at, send_count, has_sent, is_legacy, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    db.execSync("BEGIN TRANSACTION");
    for (const r of routes) {
      stmt.executeSync(
        r.id,
        r.wall_id,
        r.wall_image_id,
        r.created_by,
        r.name,
        r.grade,
        r.description,
        JSON.stringify(r.hold_ids),
        r.hold_roles ? JSON.stringify(r.hold_roles) : null,
        r.created_at,
        r.send_count,
        r.has_sent ? 1 : 0,
        r.is_legacy ? 1 : 0,
        r.status,
      );
    }
    db.execSync("COMMIT");
  } catch (e) {
    db.execSync("ROLLBACK");
    throw e;
  } finally {
    stmt.finalizeSync();
  }
}

export function upsertSends(
  sends: {
    id: string;
    route_id: string;
    user_id: string;
    sent_at: string;
    attempts: number | null;
    notes: string | null;
  }[],
) {
  const db = getDb();
  const stmt = db.prepareSync(
    "INSERT OR REPLACE INTO sends (id, route_id, user_id, sent_at, attempts, notes) VALUES (?, ?, ?, ?, ?, ?)",
  );
  try {
    db.execSync("BEGIN TRANSACTION");
    for (const s of sends) {
      stmt.executeSync(s.id, s.route_id, s.user_id, s.sent_at, s.attempts, s.notes);
    }
    db.execSync("COMMIT");
  } catch (e) {
    db.execSync("ROLLBACK");
    throw e;
  } finally {
    stmt.finalizeSync();
  }
}

export function setSyncMeta(key: string, value: string) {
  getDb().runSync(
    "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)",
    key,
    value,
  );
}

export function getSyncMeta(key: string): string | null {
  const row = getDb().getFirstSync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

// ── Pending Mutations ──────────────────────────────────

export interface PendingMutation {
  id: number;
  type: string;
  payload: string;
  created_at: string;
  status: string;
  retry_count: number;
  error: string | null;
}

export function addPendingMutation(type: string, payload: object) {
  getDb().runSync(
    "INSERT INTO pending_mutations (type, payload, created_at) VALUES (?, ?, ?)",
    type,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
}

export function getPendingMutations(): PendingMutation[] {
  return getDb().getAllSync<PendingMutation>(
    "SELECT * FROM pending_mutations WHERE status = 'pending' ORDER BY id ASC",
  );
}

export function getPendingMutationCount(): number {
  const row = getDb().getFirstSync<{ count: number }>(
    "SELECT COUNT(*) as count FROM pending_mutations WHERE status IN ('pending', 'failed')",
  );
  return row?.count ?? 0;
}

export function markMutationInFlight(id: number) {
  getDb().runSync(
    "UPDATE pending_mutations SET status = 'in_flight' WHERE id = ?",
    id,
  );
}

export function markMutationComplete(id: number) {
  getDb().runSync("DELETE FROM pending_mutations WHERE id = ?", id);
}

export function markMutationFailed(id: number, error: string) {
  getDb().runSync(
    "UPDATE pending_mutations SET status = 'failed', error = ?, retry_count = retry_count + 1 WHERE id = ?",
    error,
    id,
  );
}

export function resetFailedMutations() {
  getDb().runSync(
    "UPDATE pending_mutations SET status = 'pending' WHERE status = 'failed'",
  );
}

// ── Local writes for optimistic mutations ──────────────

export function insertLocalSend(
  id: string,
  routeId: string,
  userId: string,
) {
  const db = getDb();
  // Check if send already exists to avoid double-incrementing send_count
  const existing = db.getFirstSync<{ id: string }>(
    "SELECT id FROM sends WHERE route_id = ? AND user_id = ?",
    routeId,
    userId,
  );
  db.runSync(
    "INSERT OR REPLACE INTO sends (id, route_id, user_id, sent_at, attempts, notes) VALUES (?, ?, ?, ?, NULL, NULL)",
    id,
    routeId,
    userId,
    new Date().toISOString(),
  );
  if (!existing) {
    db.runSync(
      "UPDATE routes SET has_sent = 1, send_count = send_count + 1 WHERE id = ?",
      routeId,
    );
  }
}

export function deleteLocalSend(routeId: string, userId: string) {
  const db = getDb();
  const result = db.runSync(
    "DELETE FROM sends WHERE route_id = ? AND user_id = ?",
    routeId,
    userId,
  );
  // Only update route counts if a row was actually deleted
  if (result.changes > 0) {
    db.runSync(
      "UPDATE routes SET has_sent = 0, send_count = MAX(0, send_count - 1) WHERE id = ?",
      routeId,
    );
  }
}

export function insertLocalRoute(route: Route) {
  upsertRoutes([route]);
}

export function updateLocalRouteId(tempId: string, serverId: string) {
  const db = getDb();
  db.execSync("BEGIN TRANSACTION");
  try {
    // Update child rows first to avoid FK constraint violations
    db.runSync("UPDATE sends SET route_id = ? WHERE route_id = ?", serverId, tempId);
    db.runSync("UPDATE routes SET id = ? WHERE id = ?", serverId, tempId);
    db.execSync("COMMIT");
  } catch (e) {
    db.execSync("ROLLBACK");
    throw e;
  }
}

export function remapTempIdInPendingMutations(tempId: string, serverId: string) {
  const db = getDb();
  const mutations = db.getAllSync<{ id: number; payload: string }>(
    "SELECT id, payload FROM pending_mutations WHERE status = 'pending' AND payload LIKE ?",
    `%${tempId}%`,
  );
  for (const m of mutations) {
    const updated = m.payload.replaceAll(tempId, serverId);
    db.runSync("UPDATE pending_mutations SET payload = ? WHERE id = ?", updated, m.id);
  }
}

export function resetInFlightMutations() {
  getDb().runSync(
    "UPDATE pending_mutations SET status = 'pending' WHERE status = 'in_flight'",
  );
}

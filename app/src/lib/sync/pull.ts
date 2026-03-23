import { apiFetch } from "../api/fetch";
import type { Gym, Wall, WallDetail, Hold, Route, LogbookEntry } from "../api/types";
import {
  upsertGyms,
  upsertWalls,
  upsertWallImage,
  upsertHolds,
  upsertRoutes,
  upsertSends,
  setSyncMeta,
} from "../db/queries";

export async function pullAll(): Promise<void> {
  // 1. Fetch gyms
  const gymsRes = await apiFetch("/gyms");
  if (!gymsRes.ok) throw new Error("Failed to fetch gyms");
  const gyms: Gym[] = await gymsRes.json();
  upsertGyms(gyms);

  // 2. For each gym, fetch walls
  for (const gym of gyms) {
    const wallsRes = await apiFetch(`/gyms/${gym.slug}/walls`);
    if (!wallsRes.ok) continue;
    const walls: Wall[] = await wallsRes.json();
    upsertWalls(walls);

    // 3. For each wall, fetch detail (image + detection status)
    for (const wall of walls) {
      // 3a. Fetch wall detail (image, detection status, holds)
      const detailRes = await apiFetch(
        `/gyms/${gym.slug}/walls/${wall.id}`,
      );
      if (detailRes.ok) {
        const detail: WallDetail = await detailRes.json();

        if (detail.image) {
          upsertWallImage({
            id: detail.image.id,
            wall_id: wall.id,
            image_url: detail.image.image_url,
            is_active: detail.image.is_active,
            created_at: detail.image.created_at,
          });
        }

        if (detail.detection_status) {
          setSyncMeta(`detection_status:${wall.id}`, detail.detection_status);
        }
        if (detail.user_role) {
          setSyncMeta(`wall_user_role:${wall.id}`, detail.user_role);
        }

        // 4. If detection done, fetch holds
        if (detail.detection_status === "done") {
          const holdsRes = await apiFetch(
            `/gyms/${gym.slug}/walls/${wall.id}/holds`,
          );
          if (holdsRes.ok) {
            const holds: Hold[] = await holdsRes.json();
            upsertHolds(holds);
          }
        }
      }

      // 5. Fetch routes for this wall (independent of wall detail)
      const routesRes = await apiFetch(
        `/gyms/${gym.slug}/walls/${wall.id}/routes`,
      );
      if (routesRes.ok) {
        const routes: Route[] = await routesRes.json();
        upsertRoutes(routes);
      }
    }
  }

  // 6. Fetch logbook (sends)
  const logbookRes = await apiFetch("/users/me/logbook");
  if (logbookRes.ok) {
    const entries: LogbookEntry[] = await logbookRes.json();
    upsertSends(
      entries.map((e) => ({
        id: e.id,
        route_id: e.route_id,
        user_id: e.user_id,
        sent_at: e.sent_at,
        attempts: e.attempts,
        notes: e.notes,
      })),
    );
  }

  setSyncMeta("last_pull_at", new Date().toISOString());
}

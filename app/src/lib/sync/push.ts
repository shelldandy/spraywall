import { apiFetch } from "../api/fetch";
import {
  getPendingMutations,
  markMutationInFlight,
  markMutationComplete,
  markMutationFailed,
  updateLocalRouteId,
  resetFailedMutations,
} from "../db/queries";

export async function pushPending(): Promise<void> {
  resetFailedMutations();
  const mutations = getPendingMutations();

  for (const mutation of mutations) {
    markMutationInFlight(mutation.id);
    const payload = JSON.parse(mutation.payload);

    try {
      switch (mutation.type) {
        case "log_send": {
          const res = await apiFetch(
            `/gyms/${payload.gymSlug}/walls/${payload.wallId}/routes/${payload.routeId}/sends`,
            { method: "POST", body: JSON.stringify({}) },
          );
          // 409 conflict = send already exists, treat as success
          if (!res.ok && res.status !== 409) {
            throw new Error(`Failed to sync send: ${res.status}`);
          }
          break;
        }
        case "unsend": {
          const res = await apiFetch(
            `/gyms/${payload.gymSlug}/walls/${payload.wallId}/routes/${payload.routeId}/sends/me`,
            { method: "DELETE" },
          );
          // 404 = already deleted, treat as success
          if (!res.ok && res.status !== 404) {
            throw new Error(`Failed to sync unsend: ${res.status}`);
          }
          break;
        }
        case "create_route": {
          const res = await apiFetch(
            `/gyms/${payload.gymSlug}/walls/${payload.wallId}/routes`,
            {
              method: "POST",
              body: JSON.stringify({
                name: payload.name,
                grade: payload.grade,
                description: payload.description,
                hold_ids: payload.hold_ids,
                hold_roles: payload.hold_roles,
                status: payload.status,
              }),
            },
          );
          if (!res.ok) {
            throw new Error(`Failed to sync route creation: ${res.status}`);
          }
          const serverRoute = await res.json();
          // Remap temp ID to server ID
          if (payload.tempId && serverRoute.id !== payload.tempId) {
            updateLocalRouteId(payload.tempId, serverRoute.id);
          }
          break;
        }
        case "update_route": {
          const res = await apiFetch(
            `/gyms/${payload.gymSlug}/walls/${payload.wallId}/routes/${payload.routeId}`,
            {
              method: "PUT",
              body: JSON.stringify({
                name: payload.name,
                grade: payload.grade,
                description: payload.description,
                hold_ids: payload.hold_ids,
                hold_roles: payload.hold_roles,
                status: payload.status,
              }),
            },
          );
          if (!res.ok) {
            throw new Error(`Failed to sync route update: ${res.status}`);
          }
          break;
        }
        default:
          throw new Error(`Unknown mutation type: ${mutation.type}`);
      }
      markMutationComplete(mutation.id);
    } catch (err: any) {
      markMutationFailed(mutation.id, err.message);
    }
  }
}

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { API_BASE, apiFetch } from "../api/fetch";
import type {
  AuthConfig,
  WallDetail,
  Hold,
  Route,
  LogbookEntry,
  ClimbLog,
  Me,
  Circuit,
  ResetDiff,
  ActivityPage,
  BetaVideoList,
} from "../api/types";
import { useAuthStore } from "../store/auth";
import { fetchGymsWithWalls, type GymWithWalls } from "./gymWalls";
import { isDetecting, POLL_INTERVAL_MS, wallDetailPollInterval } from "./polling";
export type { GymWithWalls } from "./gymWalls";
export { canEditWallHolds, shouldLoadHolds } from "./holdAvailability";
export { isDetecting, POLL_INTERVAL_MS } from "./polling";

export function useGymsWithWalls(enabled = true) {
  return useQuery<GymWithWalls[]>({
    queryKey: ["gyms-with-walls"],
    queryFn: () => fetchGymsWithWalls(apiFetch),
    enabled,
  });
}

export function useWallDetail(
  wallId: string,
  gymSlug?: string,
  options: { pollPendingReset?: boolean } = {},
) {
  return useQuery<WallDetail | null>({
    queryKey: ["wall-detail", wallId],
    queryFn: async () => {
      if (!gymSlug) return null;
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}`);
      if (!res.ok) throw new Error("Failed to fetch wall");
      return res.json();
    },
    refetchInterval: (query) =>
      wallDetailPollInterval(
        query.state.data?.detection_status,
        query.state.data?.pending_reset?.detection_status,
        options.pollPendingReset,
      ),
  });
}

export function useResetDiff(gymSlug?: string, wallId?: string, imageId?: string) {
  return useQuery<ResetDiff>({
    queryKey: ["reset-diff", wallId, imageId],
    queryFn: async () => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/resets/${imageId}`);
      if (!res.ok) throw new Error("Failed to fetch reset review");
      return res.json();
    },
    enabled: Boolean(gymSlug && wallId && imageId),
    refetchInterval: (query) => isDetecting(query.state.data?.detection_status) ? POLL_INTERVAL_MS : false,
  });
}

export function useHolds(wallId: string, enabled = true, gymSlug?: string) {
  return useQuery<Hold[]>({
    queryKey: ["holds", wallId],
    queryFn: async () => {
      if (!gymSlug) return [];
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/holds`);
      if (!res.ok) throw new Error("Failed to fetch holds");
      return res.json();
    },
    enabled,
  });
}

export function useRoutes(wallId: string, gymSlug?: string) {
  const userId = useAuthStore((s) => s.userId);
  return useQuery<Route[]>({
    queryKey: ["routes", wallId, userId],
    queryFn: async () => {
      if (!gymSlug) return [];
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes`);
      if (!res.ok) throw new Error("Failed to fetch routes");
      return res.json();
    },
  });
}

export function useCircuits(wallId: string, gymSlug?: string) {
  const userId = useAuthStore((s) => s.userId);
  return useQuery<Circuit[]>({
    queryKey: ["circuits", wallId, userId],
    queryFn: async () => {
      if (!gymSlug) return [];
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/circuits`);
      if (!res.ok) throw new Error("Failed to fetch circuits");
      return res.json();
    },
    enabled: Boolean(wallId && gymSlug),
  });
}

export function useRouteDetail(routeId: string, gymSlug?: string, wallId?: string) {
  const userId = useAuthStore((s) => s.userId);
  return useQuery<Route | null>({
    queryKey: ["route-detail", routeId, userId],
    queryFn: async () => {
      if (!gymSlug || !wallId) return null;
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}`);
      if (!res.ok) throw new Error("Failed to fetch route");
      return res.json();
    },
  });
}

export function useRouteLogs(routeId: string, gymSlug?: string, wallId?: string) {
  const userId = useAuthStore((s) => s.userId);
  return useQuery<ClimbLog[]>({
    queryKey: ["climb-logs", routeId, userId],
    queryFn: async () => {
      if (!gymSlug || !wallId) return [];
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/logs`);
      if (!res.ok) throw new Error("Failed to fetch climb history");
      return res.json();
    },
    enabled: Boolean(routeId && gymSlug && wallId),
  });
}

export function useBetaVideos({ gymSlug, wallId, routeId }: { gymSlug: string; wallId: string; routeId: string }) {
  return useQuery<BetaVideoList>({
    queryKey: ["beta-videos", routeId],
    queryFn: async () => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/beta-videos`);
      if (!res.ok) throw new Error("Failed to fetch beta videos");
      return res.json();
    },
    enabled: Boolean(gymSlug && wallId && routeId),
  });
}

export function useActivity({ gymSlug, wallId, routeId }: { gymSlug: string; wallId: string; routeId?: string }) {
  const userId = useAuthStore((s) => s.userId);
  return useInfiniteQuery({
    queryKey: ["activity", wallId, routeId ?? "wall", userId],
    queryFn: async ({ pageParam }) => {
      const endpoint = routeId
        ? `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/activity`
        : `/gyms/${gymSlug}/walls/${wallId}/activity`;
      const search = new URLSearchParams();
      if (pageParam) search.set("cursor", pageParam);
      const res = await apiFetch(`${endpoint}${search.size ? `?${search}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch activity");
      return res.json() as Promise<ActivityPage>;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
    enabled: Boolean(gymSlug && wallId),
  });
}

export function useLogbook() {
  const userId = useAuthStore((s) => s.userId);
  return useQuery<LogbookEntry[]>({
    queryKey: ["logbook", userId],
    queryFn: async () => {
      const res = await apiFetch("/users/me/logbook");
      if (!res.ok) throw new Error("Failed to fetch logbook");
      return res.json();
    },
  });
}

/** Which login methods the server offers. Public, so it's a plain fetch without auth. */
export function useAuthConfig() {
  return useQuery<AuthConfig>({
    queryKey: ["auth-config"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/auth/config`);
      if (!res.ok) throw new Error("Failed to fetch auth config");
      return res.json();
    },
    // Server config only changes on redeploy.
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });
}

/** The logged-in user's profile. Keyed by user id (like the logbook) so accounts never share a cache entry. */
export function useMe() {
  const userId = useAuthStore((s) => s.userId);
  return useQuery<Me>({
    queryKey: ["me", userId],
    queryFn: async () => {
      const res = await apiFetch("/auth/me");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });
}

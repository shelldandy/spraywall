import { useQuery } from "@tanstack/react-query";
import { API_BASE, apiFetch } from "../api/fetch";
import type {
  AuthConfig,
  Gym,
  Wall,
  WallDetail,
  Hold,
  Route,
  LogbookEntry,
  ClimbLog,
  Me,
  Circuit,
} from "../api/types";
import { useAuthStore } from "../store/auth";

export interface GymWithWalls extends Gym {
  walls: Wall[];
}

export function useGyms() {
  return useQuery<Gym[]>({
    queryKey: ["gyms"],
    queryFn: async () => {
      const res = await apiFetch("/gyms");
      if (!res.ok) throw new Error("Failed to fetch gyms");
      return res.json();
    },
  });
}

export function useGymsWithWalls() {
  return useQuery<GymWithWalls[]>({
    queryKey: ["gyms-with-walls"],
    queryFn: async () => {
      const gymsRes = await apiFetch("/gyms");
      if (!gymsRes.ok) throw new Error("Failed to fetch gyms");
      const gyms: Gym[] = await gymsRes.json();
      return Promise.all(
        gyms.map(async (gym) => {
          const res = await apiFetch(`/gyms/${gym.slug}/walls`);
          const walls: Wall[] = res.ok ? await res.json() : [];
          return { ...gym, walls };
        }),
      );
    },
  });
}

export function useWallDetail(wallId: string, gymSlug?: string) {
  const query = useQuery<WallDetail | null>({
    queryKey: ["wall-detail", wallId],
    queryFn: async () => {
      if (!gymSlug) return null;
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}`);
      if (!res.ok) throw new Error("Failed to fetch wall");
      return res.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.detection_status;
      return status === "pending" || status === "processing" ? 3000 : false;
    },
  });
  return query;
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

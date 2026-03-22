import { useQuery } from "@tanstack/react-query";
import { isDbAvailable } from "../db/database";
import { apiFetch } from "../api/fetch";
import type { Gym, Wall, WallDetail, Hold, Route, LogbookEntry } from "../api/types";
import { useServerStore } from "../store/server";

// On native: read from SQLite (sync engine keeps it fresh)
// On web: fetch from server directly (no SQLite available)

function getDbQueries() {
  // Lazy import to avoid pulling expo-sqlite on web
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../db/queries") as typeof import("../db/queries");
}

export interface GymWithWalls extends Gym {
  walls: Wall[];
}

export function useGyms() {
  return useQuery<Gym[]>({
    queryKey: ["gyms"],
    queryFn: async () => {
      if (isDbAvailable()) return getDbQueries().getGyms();
      const res = await apiFetch("/gyms");
      if (!res.ok) throw new Error("Failed to fetch gyms");
      return res.json();
    },
    staleTime: isDbAvailable() ? Infinity : 0,
  });
}

export function useGymsWithWalls() {
  return useQuery<GymWithWalls[]>({
    queryKey: ["gyms-with-walls"],
    queryFn: async () => {
      if (isDbAvailable()) return getDbQueries().getGymsWithWalls();
      const gymsRes = await apiFetch("/gyms");
      if (!gymsRes.ok) throw new Error("Failed to fetch gyms");
      const gyms: Gym[] = await gymsRes.json();
      const results = await Promise.all(
        gyms.map(async (gym) => {
          const res = await apiFetch(`/gyms/${gym.slug}/walls`);
          const walls: Wall[] = res.ok ? await res.json() : [];
          return { ...gym, walls };
        }),
      );
      return results;
    },
    staleTime: isDbAvailable() ? Infinity : 0,
  });
}

export function useWallDetail(wallId: string, gymSlug?: string) {
  return useQuery<WallDetail | null>({
    queryKey: ["wall-detail", wallId],
    queryFn: async () => {
      if (isDbAvailable()) return getDbQueries().getWallDetail(wallId);
      if (!gymSlug) return null;
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}`);
      if (!res.ok) throw new Error("Failed to fetch wall");
      return res.json();
    },
    staleTime: isDbAvailable() ? Infinity : 0,
  });
}

export function useHolds(wallId: string, enabled = true, gymSlug?: string) {
  return useQuery<Hold[]>({
    queryKey: ["holds", wallId],
    queryFn: async () => {
      if (isDbAvailable()) return getDbQueries().getHoldsByWallId(wallId);
      if (!gymSlug) return [];
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/holds`);
      if (!res.ok) throw new Error("Failed to fetch holds");
      return res.json();
    },
    enabled,
    staleTime: isDbAvailable() ? Infinity : 0,
  });
}

export function useRoutes(wallId: string, gymSlug?: string) {
  return useQuery<Route[]>({
    queryKey: ["routes", wallId],
    queryFn: async () => {
      if (isDbAvailable()) return getDbQueries().getRoutesByWallId(wallId);
      if (!gymSlug) return [];
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes`);
      if (!res.ok) throw new Error("Failed to fetch routes");
      return res.json();
    },
    staleTime: isDbAvailable() ? Infinity : 0,
  });
}

export function useRouteDetail(routeId: string, gymSlug?: string, wallId?: string) {
  return useQuery<Route | null>({
    queryKey: ["route-detail", routeId],
    queryFn: async () => {
      if (isDbAvailable()) return getDbQueries().getRouteDetail(routeId);
      if (!gymSlug || !wallId) return null;
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}`);
      if (!res.ok) throw new Error("Failed to fetch route");
      return res.json();
    },
    staleTime: isDbAvailable() ? Infinity : 0,
  });
}

export function useLogbook() {
  const { userId } = useServerStore();
  return useQuery<LogbookEntry[]>({
    queryKey: ["logbook"],
    queryFn: async () => {
      if (isDbAvailable() && userId) return getDbQueries().getLogbook(userId);
      const res = await apiFetch("/users/me/logbook");
      if (!res.ok) throw new Error("Failed to fetch logbook");
      return res.json();
    },
    staleTime: isDbAvailable() ? Infinity : 0,
  });
}

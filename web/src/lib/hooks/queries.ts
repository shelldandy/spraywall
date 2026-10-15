import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/fetch";
import type { Gym, Wall, WallDetail, Hold, Route, LogbookEntry } from "../api/types";
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
  return useQuery<WallDetail | null>({
    queryKey: ["wall-detail", wallId],
    queryFn: async () => {
      if (!gymSlug) return null;
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}`);
      if (!res.ok) throw new Error("Failed to fetch wall");
      return res.json();
    },
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
  return useQuery<Route[]>({
    queryKey: ["routes", wallId],
    queryFn: async () => {
      if (!gymSlug) return [];
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes`);
      if (!res.ok) throw new Error("Failed to fetch routes");
      return res.json();
    },
  });
}

export function useRouteDetail(routeId: string, gymSlug?: string, wallId?: string) {
  return useQuery<Route | null>({
    queryKey: ["route-detail", routeId],
    queryFn: async () => {
      if (!gymSlug || !wallId) return null;
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}`);
      if (!res.ok) throw new Error("Failed to fetch route");
      return res.json();
    },
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

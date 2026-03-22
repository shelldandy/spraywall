import { useQuery } from "@tanstack/react-query";
import {
  getGyms,
  getGymsWithWalls,
  getWallDetail,
  getHoldsByWallId,
  getRoutesByWallId,
  getRouteDetail,
  getLogbook,
} from "../db/queries";
import type { GymWithWalls } from "../db/queries";
import type { Gym, WallDetail, Hold, Route, LogbookEntry } from "../api/types";
import { useServerStore } from "../store/server";

export function useGyms() {
  return useQuery<Gym[]>({
    queryKey: ["gyms"],
    queryFn: () => getGyms(),
    staleTime: Infinity,
  });
}

export function useGymsWithWalls() {
  return useQuery<GymWithWalls[]>({
    queryKey: ["gyms-with-walls"],
    queryFn: () => getGymsWithWalls(),
    staleTime: Infinity,
  });
}

export function useWallDetail(wallId: string) {
  return useQuery<WallDetail | null>({
    queryKey: ["wall-detail", wallId],
    queryFn: () => getWallDetail(wallId),
    staleTime: Infinity,
  });
}

export function useHolds(wallId: string, enabled = true) {
  return useQuery<Hold[]>({
    queryKey: ["holds", wallId],
    queryFn: () => getHoldsByWallId(wallId),
    enabled,
    staleTime: Infinity,
  });
}

export function useRoutes(wallId: string) {
  return useQuery<Route[]>({
    queryKey: ["routes", wallId],
    queryFn: () => getRoutesByWallId(wallId),
    staleTime: Infinity,
  });
}

export function useRouteDetail(routeId: string) {
  return useQuery<Route | null>({
    queryKey: ["route-detail", routeId],
    queryFn: () => getRouteDetail(routeId),
    staleTime: Infinity,
  });
}

export function useLogbook() {
  const { userId } = useServerStore();
  return useQuery<LogbookEntry[]>({
    queryKey: ["logbook"],
    queryFn: () => (userId ? getLogbook(userId) : []),
    staleTime: Infinity,
  });
}

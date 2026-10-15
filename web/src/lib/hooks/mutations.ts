import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/fetch";
import type { HoldRoles } from "../api/types";
import { toastError } from "../toast";

export interface RouteParams {
  name: string;
  grade: string | null;
  description: string | null;
  hold_ids: string[];
  hold_roles: HoldRoles | null;
  status: "draft" | "published";
}

async function ensureOk(res: Response, fallback: string) {
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || fallback);
  }
}

export function useLogSend(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/sends`,
        { method: "POST", body: JSON.stringify({}) },
      );
      await ensureOk(res, "Failed to log send");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
    },
    onError: toastError,
  });
}

export function useUnsend(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch(
        `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/sends/me`,
        { method: "DELETE" },
      );
      await ensureOk(res, "Failed to remove send");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
    },
    onError: toastError,
  });
}

export function useCreateRoute(gymSlug: string, wallId: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, RouteParams>({
    mutationFn: async (params) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes`, {
        method: "POST",
        body: JSON.stringify(params),
      });
      await ensureOk(res, "Failed to create route");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
    },
    onError: toastError,
  });
}

export function useUpdateRoute(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, RouteParams>({
    mutationFn: async (params) => {
      const res = await apiFetch(
        `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}`,
        { method: "PUT", body: JSON.stringify(params) },
      );
      await ensureOk(res, "Failed to update route");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
    },
    onError: toastError,
  });
}

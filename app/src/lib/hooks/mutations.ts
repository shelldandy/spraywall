import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";
import { useServerStore } from "../store/server";
import { useSyncStore } from "../store/sync";
import {
  insertLocalSend,
  deleteLocalSend,
  insertLocalRoute,
  addPendingMutation,
  getPendingMutationCount,
} from "../db/queries";
import { triggerSync } from "../sync/engine";
import type { Route } from "../api/types";

function generateId(): string {
  // Simple UUID v4 generator for temp IDs
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useLogSend(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  const { userId } = useServerStore();

  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not authenticated");
      const sendId = generateId();
      insertLocalSend(sendId, routeId, userId);
      addPendingMutation("log_send", { gymSlug, wallId, routeId });
      useSyncStore.getState().setPendingCount(getPendingMutationCount());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
      triggerSync(queryClient);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });
}

export function useUnsend(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  const { userId } = useServerStore();

  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not authenticated");
      deleteLocalSend(routeId, userId);
      addPendingMutation("unsend", { gymSlug, wallId, routeId });
      useSyncStore.getState().setPendingCount(getPendingMutationCount());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
      triggerSync(queryClient);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });
}

export function useCreateRoute(gymSlug: string, wallId: string) {
  const queryClient = useQueryClient();
  const { userId } = useServerStore();

  return useMutation<
    void,
    Error,
    {
      name: string;
      grade: string | null;
      description: string | null;
      hold_ids: string[];
      hold_roles: { start: string[]; finish: string[] } | null;
      status: "draft" | "published";
    }
  >({
    mutationFn: async (params) => {
      if (!userId) throw new Error("Not authenticated");
      const tempId = generateId();
      const now = new Date().toISOString();

      const route: Route = {
        id: tempId,
        wall_id: wallId,
        wall_image_id: "",
        created_by: userId,
        name: params.name,
        grade: params.grade,
        description: params.description,
        hold_ids: params.hold_ids,
        hold_roles: params.hold_roles,
        created_at: now,
        send_count: 0,
        has_sent: false,
        is_legacy: false,
        status: params.status,
      };
      insertLocalRoute(route);
      addPendingMutation("create_route", {
        gymSlug,
        wallId,
        tempId,
        ...params,
      });
      useSyncStore.getState().setPendingCount(getPendingMutationCount());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      triggerSync(queryClient);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });
}

export function useUpdateRoute(
  gymSlug: string,
  wallId: string,
  routeId: string,
) {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    {
      name: string;
      grade: string | null;
      description: string | null;
      hold_ids: string[];
      hold_roles: { start: string[]; finish: string[] } | null;
      status: "draft" | "published";
    }
  >({
    mutationFn: async (params) => {
      // Update locally
      const { getDb } = await import("../db/database");
      getDb().runSync(
        `UPDATE routes SET name = ?, grade = ?, description = ?, hold_ids = ?, hold_roles = ?, status = ? WHERE id = ?`,
        params.name,
        params.grade,
        params.description,
        JSON.stringify(params.hold_ids),
        params.hold_roles ? JSON.stringify(params.hold_roles) : null,
        params.status,
        routeId,
      );
      addPendingMutation("update_route", {
        gymSlug,
        wallId,
        routeId,
        ...params,
      });
      useSyncStore.getState().setPendingCount(getPendingMutationCount());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      triggerSync(queryClient);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });
}

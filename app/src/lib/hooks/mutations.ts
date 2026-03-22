import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";
import { useServerStore } from "../store/server";
import { useSyncStore } from "../store/sync";
import { isDbAvailable } from "../db/database";
import { apiFetch } from "../api/fetch";
import { triggerSync } from "../sync/engine";
import type { Route } from "../api/types";

function getDbQueries() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../db/queries") as typeof import("../db/queries");
}

function generateId(): string {
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
      if (isDbAvailable()) {
        if (!userId) throw new Error("Not authenticated");
        const db = getDbQueries();
        const sendId = generateId();
        db.insertLocalSend(sendId, routeId, userId);
        db.addPendingMutation("log_send", { gymSlug, wallId, routeId });
        useSyncStore.getState().setPendingCount(db.getPendingMutationCount());
      } else {
        const res = await apiFetch(
          `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/sends`,
          { method: "POST", body: JSON.stringify({}) },
        );
        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || "Failed to log send");
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
      if (isDbAvailable()) triggerSync(queryClient);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });
}

export function useUnsend(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  const { userId } = useServerStore();

  return useMutation({
    mutationFn: async () => {
      if (isDbAvailable()) {
        if (!userId) throw new Error("Not authenticated");
        const db = getDbQueries();
        db.deleteLocalSend(routeId, userId);
        db.addPendingMutation("unsend", { gymSlug, wallId, routeId });
        useSyncStore.getState().setPendingCount(db.getPendingMutationCount());
      } else {
        const res = await apiFetch(
          `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/sends/me`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || "Failed to remove send");
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
      if (isDbAvailable()) triggerSync(queryClient);
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
      if (isDbAvailable()) {
        if (!userId) throw new Error("Not authenticated");
        const db = getDbQueries();
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
        db.insertLocalRoute(route);
        db.addPendingMutation("create_route", {
          gymSlug,
          wallId,
          tempId,
          ...params,
        });
        useSyncStore.getState().setPendingCount(db.getPendingMutationCount());
      } else {
        const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes`, {
          method: "POST",
          body: JSON.stringify(params),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || "Failed to create route");
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      if (isDbAvailable()) triggerSync(queryClient);
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
      if (isDbAvailable()) {
        const db = getDbQueries();
        const { getDb } = require("../db/database") as typeof import("../db/database");
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
        db.addPendingMutation("update_route", {
          gymSlug,
          wallId,
          routeId,
          ...params,
        });
        useSyncStore.getState().setPendingCount(db.getPendingMutationCount());
      } else {
        const res = await apiFetch(
          `/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}`,
          { method: "PUT", body: JSON.stringify(params) },
        );
        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || "Failed to update route");
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      if (isDbAvailable()) triggerSync(queryClient);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });
}

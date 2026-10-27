import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/fetch";
import { prepareImageForUpload } from "../image";
import type { BetaVideo, Circuit, HoldRoles, Me } from "../api/types";
import type { RouteTagId } from "../routeTags";
import { useAuthStore } from "../store/auth";
import { toastError } from "../toast";

export async function uploadWallImage(
  gymSlug: string,
  wallId: string,
  image: Blob,
  mode: "full" | "partial" = "full",
) {
  const file =
    image instanceof File
      ? image
      : new File([image], "photo.jpg", { type: image.type || "image/jpeg" });
  const prepared = await prepareImageForUpload(file);
  const form = new FormData();
  form.append("image", prepared, prepared instanceof File ? prepared.name : "photo.jpg");
  form.append("mode", mode);
  return apiFetch(`/gyms/${gymSlug}/walls/${wallId}/images`, {
    method: "POST",
    body: form,
  });
}

function invalidateResetQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  wallId: string,
  imageId: string,
) {
  queryClient.invalidateQueries({ queryKey: ["reset-diff", wallId, imageId] });
  queryClient.invalidateQueries({ queryKey: ["wall-detail", wallId] });
  queryClient.invalidateQueries({ queryKey: ["holds", wallId] });
  queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
  queryClient.invalidateQueries({ queryKey: ["circuits", wallId] });
}

function useResetMutation<T>(
  gymSlug: string,
  wallId: string,
  imageId: string,
  action: string,
  method: string,
) {
  const queryClient = useQueryClient();
  return useMutation<T, Error, void | { old_hold_id: string; new_hold_id?: string | null }>({
    mutationFn: async (variables) => {
      const request: RequestInit = { method };
      if (variables) request.body = JSON.stringify(variables);

      const response = await apiFetch(
        `/gyms/${gymSlug}/walls/${wallId}/resets/${imageId}${action}`,
        request,
      );
      await ensureOkJson(response, "Reset request failed");
      return method === "DELETE" ? (undefined as T) : response.json();
    },
    onSuccess: () => invalidateResetQueries(queryClient, wallId, imageId),
    onError: toastError,
  });
}

export function useMatchResetHold(gymSlug: string, wallId: string, imageId: string) {
  return useResetMutation<void>(gymSlug, wallId, imageId, "/matches", "PUT");
}

export function useDeleteResetHold(gymSlug: string, wallId: string, imageId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (holdId) => {
      const response = await apiFetch(
        `/gyms/${gymSlug}/walls/${wallId}/resets/${imageId}/holds/${holdId}`,
        { method: "DELETE" },
      );
      await ensureOkJson(response, "Could not delete hold");
    },
    onSuccess: () => invalidateResetQueries(queryClient, wallId, imageId),
    onError: toastError,
  });
}

export function useRestoreResetHold(gymSlug: string, wallId: string, imageId: string) {
  return useResetMutation<void>(gymSlug, wallId, imageId, "/restore", "POST");
}

export function useApplyReset(gymSlug: string, wallId: string, imageId: string) {
  return useResetMutation<{ kept: number; archived: number }>(gymSlug, wallId, imageId, "/apply", "POST");
}

export function useDiscardReset(gymSlug: string, wallId: string, imageId: string) {
  return useResetMutation<void>(gymSlug, wallId, imageId, "", "DELETE");
}

export interface RouteParams {
  name: string;
  grade: string | null;
  description: string | null;
  hold_ids: string[];
  hold_roles: HoldRoles | null;
  status: "draft" | "published";
  tags: RouteTagId[];
}

async function ensureOk(res: Response, fallback: string) {
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || fallback);
  }
}

export interface ClimbLogInput {
  outcome: "attempt" | "send" | "flash";
  climbed_on: string;
  notes: string | null;
}

function invalidateClimbData(queryClient: ReturnType<typeof useQueryClient>, routeId: string, wallId: string) {
  queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
  queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
  queryClient.invalidateQueries({ queryKey: ["climb-logs", routeId] });
  queryClient.invalidateQueries({ queryKey: ["activity", wallId] });
  queryClient.invalidateQueries({ queryKey: ["logbook"] });
}

export function useCreateClimbLog(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ClimbLogInput>({
    mutationFn: async (input) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/logs`, {
        method: "POST", body: JSON.stringify(input),
      });
      await ensureOkJson(res, "Failed to log climb");
    },
    onSuccess: () => invalidateClimbData(queryClient, routeId, wallId),
  });
}

export function useUpdateClimbLog(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ClimbLogInput & { logId: string }>({
    mutationFn: async ({ logId, ...input }) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/logs/${logId}`, {
        method: "PUT", body: JSON.stringify(input),
      });
      await ensureOkJson(res, "Failed to update climb");
    },
    onSuccess: () => invalidateClimbData(queryClient, routeId, wallId),
  });
}

export function useDeleteClimbLog(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (logId) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/logs/${logId}`, { method: "DELETE" });
      await ensureOkJson(res, "Failed to delete log entry");
    },
    onSuccess: () => invalidateClimbData(queryClient, routeId, wallId),
  });
}

export function useCreateBetaVideo(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  return useMutation<BetaVideo, Error, { url: string; climber_handle?: string }>({
    mutationFn: async (input) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/beta-videos`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      await ensureOkJson(res, "Failed to add beta video");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["beta-videos", routeId] }),
    onError: toastError,
  });
}

export function useDeleteBetaVideo(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (videoId) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/beta-videos/${videoId}`, { method: "DELETE" });
      await ensureOkJson(res, "Failed to delete beta video");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["beta-videos", routeId] }),
    onError: toastError,
  });
}

export function useSetRouteRating(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: async (stars) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/rating`, { method: "PUT", body: JSON.stringify({ stars }) });
      await ensureOkJson(res, "Failed to save rating");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
    },
  });
}

export function useDeleteRouteRating(gymSlug: string, wallId: string, routeId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/routes/${routeId}/rating`, { method: "DELETE" });
      await ensureOkJson(res, "Failed to clear rating");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
    },
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

// --- Circuits ---

export function useCreateCircuit(gymSlug: string, wallId: string) {
  const queryClient = useQueryClient();
  return useMutation<Circuit, Error, { name: string; color?: string; emoji?: string; is_shared?: boolean; route_ids?: string[] }>({
    mutationFn: async (input) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/circuits`, { method: "POST", body: JSON.stringify(input) });
      await ensureOkJson(res, "Failed to create circuit");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["circuits", wallId] }),
    onError: toastError,
  });
}

export function useUpdateCircuit(gymSlug: string, wallId: string, circuitId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { name?: string; color?: string; emoji?: string; is_shared?: boolean }>({
    mutationFn: async (input) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/circuits/${circuitId}`, { method: "PATCH", body: JSON.stringify(input) });
      await ensureOkJson(res, "Failed to update circuit");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["circuits", wallId] }),
    onError: toastError,
  });
}

export function useDeleteCircuit(gymSlug: string, wallId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (circuitId) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/circuits/${circuitId}`, { method: "DELETE" });
      await ensureOkJson(res, "Failed to delete circuit");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["circuits", wallId] }),
    onError: toastError,
  });
}

export function useSetCircuitRoutes(gymSlug: string, wallId: string, circuitId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string[]>({
    mutationFn: async (route_ids) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/circuits/${circuitId}/routes`, { method: "PUT", body: JSON.stringify({ route_ids }) });
      await ensureOkJson(res, "Failed to save circuit routes");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["circuits", wallId] }),
    onError: toastError,
  });
}

export function useToggleCircuitRoute(gymSlug: string, wallId: string, circuitId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { route_id: string; included: boolean }>({
    mutationFn: async ({ route_id, included }) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/circuits/${circuitId}/routes${included ? "" : `/${route_id}`}`, {
        method: included ? "POST" : "DELETE",
        ...(included ? { body: JSON.stringify({ route_id }) } : {}),
      });
      await ensureOkJson(res, "Failed to update circuit route");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["circuits", wallId] }),
    onError: toastError,
  });
}

// --- Profile ---

/** Like ensureOk, but surfaces the `{error}` message the auth/profile endpoints return. */
async function ensureOkJson(res: Response, fallback: string) {
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || fallback);
  }
}

/** Profile endpoints answer with the updated Me; write it straight into the ["me", userId] cache. */
function useSetMe() {
  const queryClient = useQueryClient();
  return (me: Me) => queryClient.setQueriesData<Me>({ queryKey: ["me"] }, me);
}

export function useUpdateDisplayName() {
  const setMe = useSetMe();

  return useMutation<Me, Error, string>({
    mutationFn: async (displayName) => {
      const res = await apiFetch("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ display_name: displayName }),
      });
      await ensureOkJson(res, "Failed to update name");
      return res.json();
    },
    onSuccess: setMe,
    onError: toastError,
  });
}

export interface PasswordParams {
  current_password?: string;
  new_password: string;
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  const setTokens = useAuthStore((s) => s.setTokens);

  return useMutation<void, Error, PasswordParams>({
    mutationFn: async (params) => {
      const res = await apiFetch("/users/me/password", {
        method: "PUT",
        body: JSON.stringify(params),
      });
      await ensureOkJson(res, "Failed to change password");
      // Other sessions are revoked server-side; this one continues with a fresh pair.
      const data = await res.json();
      setTokens(data.access_token, data.refresh_token);
    },
    onSuccess: () => {
      // has_password may have flipped for OIDC-only accounts.
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: toastError,
  });
}

export function useUploadAvatar() {
  const setMe = useSetMe();

  return useMutation<Me, Error, Blob>({
    mutationFn: async (image) => {
      const form = new FormData();
      form.append("avatar", image, image instanceof File ? image.name : "avatar.jpg");
      const res = await apiFetch("/users/me/avatar", { method: "POST", body: form });
      await ensureOkJson(res, "Failed to upload photo");
      return res.json();
    },
    onSuccess: setMe,
    onError: toastError,
  });
}

export function useRemoveAvatar() {
  const setMe = useSetMe();

  return useMutation<Me, Error, void>({
    mutationFn: async () => {
      const res = await apiFetch("/users/me/avatar", { method: "DELETE" });
      await ensureOkJson(res, "Failed to remove photo");
      return res.json();
    },
    onSuccess: setMe,
    onError: toastError,
  });
}

export function useUnlinkIdentity() {
  const setMe = useSetMe();

  return useMutation<Me, Error, string>({
    mutationFn: async (identityId) => {
      const res = await apiFetch(`/users/me/identities/${identityId}`, { method: "DELETE" });
      await ensureOkJson(res, "Failed to unlink account");
      return res.json();
    },
    onSuccess: setMe,
    onError: toastError,
  });
}

/**
 * Start linking an IdP account. A plain browser navigation can't carry the bearer token,
 * so the server hands back the authorize URL and we navigate there ourselves.
 */
export function useStartOidcLink() {
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const res = await apiFetch("/auth/oidc/link", { method: "POST" });
      await ensureOkJson(res, "Failed to start linking");
      const data: { url: string } = await res.json();
      window.location.assign(data.url);
    },
    onError: toastError,
  });
}

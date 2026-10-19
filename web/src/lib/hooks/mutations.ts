import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/fetch";
import type { HoldRoles, Me } from "../api/types";
import type { RouteTagId } from "../routeTags";
import { useAuthStore } from "../store/auth";
import { toastError } from "../toast";

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

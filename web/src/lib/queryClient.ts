import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";
import { useAuthStore } from "./store/auth";
import { queryRetryDelay } from "./api/refreshPolicy";
import { withAuthLock } from "./api/refreshLock";

const ONE_DAY = 1000 * 60 * 60 * 24;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data around long enough to be persisted and shown offline.
      gcTime: ONE_DAY,
      // Show cached data while offline instead of pausing with no data.
      networkMode: "offlineFirst",
      // Honor Retry-After on transient refresh failures; otherwise use bounded backoff.
      retryDelay: queryRetryDelay,
    },
    mutations: {
      // Writes need a network: fail fast with an error rather than silently pausing.
      networkMode: "always",
    },
  },
});

const PERSIST_KEY = "spraywall-query-cache";

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: PERSIST_KEY,
});

export const persistOptions = {
  persister,
  maxAge: ONE_DAY,
  // Bump to discard caches written by an incompatible build.
  buster: "v2",
};

export async function clearLocalSession() {
  useAuthStore.getState().clearTokens();
  queryClient.clear();
  await persister.removeClient();
}

/** Revoke the server token before dropping local auth state. */
export async function logout() {
  const clearAndRevoke = async () => {
    await useAuthStore.persist.rehydrate();
    const refreshToken = useAuthStore.getState().refreshToken;
    useAuthStore.getState().clearTokens();
    queryClient.clear();
    try {
      if (refreshToken) {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      }
    } catch {
      // Local logout must still succeed when the server is unreachable.
    }
    await persister.removeClient();
  };

  await withAuthLock(clearAndRevoke);
}

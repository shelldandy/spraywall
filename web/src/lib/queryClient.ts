import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";
import { useAuthStore } from "./store/auth";

const ONE_DAY = 1000 * 60 * 60 * 24;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data around long enough to be persisted and shown offline.
      gcTime: ONE_DAY,
      // Show cached data while offline instead of pausing with no data.
      networkMode: "offlineFirst",
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

/** Log out: drop tokens and every cached response, in memory and in IndexedDB. */
export async function logout() {
  useAuthStore.getState().clearTokens();
  queryClient.clear();
  await persister.removeClient();
}

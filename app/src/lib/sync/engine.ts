import { QueryClient } from "@tanstack/react-query";
import { AppState, AppStateStatus } from "react-native";
import { pullAll } from "./pull";
import { pushPending } from "./push";
import { useSyncStore } from "../store/sync";
import { getPendingMutationCount } from "../db/queries";
import { useServerStore } from "../store/server";

const SYNC_INTERVAL_MS = 60_000;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

async function runSync(queryClient: QueryClient) {
  const { isAuthenticated, serverUrl } = useServerStore.getState();
  if (!isAuthenticated() || !serverUrl) return;

  const store = useSyncStore.getState();
  if (store.isSyncing) return;

  store.setSyncing(true);
  try {
    // Push first so local changes reach the server before we pull
    await pushPending();
    await pullAll();

    store.setOnline(true);
    store.setLastSynced(new Date().toISOString());

    // Invalidate all queries so UI re-reads from SQLite
    queryClient.invalidateQueries();
  } catch {
    // If fetch fails, we're likely offline
    store.setOnline(false);
  } finally {
    store.setSyncing(false);
    store.setPendingCount(getPendingMutationCount());
  }
}

export function startSyncEngine(queryClient: QueryClient) {
  // Initial sync
  runSync(queryClient);

  // Periodic sync
  syncInterval = setInterval(() => runSync(queryClient), SYNC_INTERVAL_MS);

  // Sync on app foreground
  appStateSubscription = AppState.addEventListener(
    "change",
    (state: AppStateStatus) => {
      if (state === "active") {
        runSync(queryClient);
      }
    },
  );
}

export function stopSyncEngine() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
}

/** Trigger a sync immediately (e.g. after a local mutation) */
export function triggerSync(queryClient: QueryClient) {
  runSync(queryClient);
}

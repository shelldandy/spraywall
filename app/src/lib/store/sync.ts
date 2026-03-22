import { create } from "zustand";

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  pendingMutationCount: number;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSynced: (at: string) => void;
  setPendingCount: (count: number) => void;
}

export const useSyncStore = create<SyncState>()((set) => ({
  isOnline: true,
  isSyncing: false,
  lastSyncedAt: null,
  pendingMutationCount: 0,
  setOnline: (online) => set({ isOnline: online }),
  setSyncing: (syncing) => set({ isSyncing: syncing }),
  setLastSynced: (at) => set({ lastSyncedAt: at }),
  setPendingCount: (count) => set({ pendingMutationCount: count }),
}));

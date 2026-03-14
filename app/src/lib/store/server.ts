import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface ServerState {
  serverUrl: string;
  authToken: string | null;
  setServerUrl: (url: string) => void;
  setAuthToken: (token: string | null) => void;
}

export const useServerStore = create<ServerState>()(
  persist(
    (set) => ({
      serverUrl: "",
      authToken: null,
      setServerUrl: (url: string) => set({ serverUrl: url }),
      setAuthToken: (token: string | null) => set({ authToken: token }),
    }),
    {
      name: "server-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

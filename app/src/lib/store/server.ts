import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface AuthState {
  serverUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  setServerUrl: (url: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  clearTokens: () => void;
  isAuthenticated: () => boolean;
}

export const useServerStore = create<AuthState>()(
  persist(
    (set, get) => ({
      serverUrl: "",
      accessToken: null,
      refreshToken: null,
      setServerUrl: (url: string) => set({ serverUrl: url }),
      setTokens: (accessToken: string, refreshToken: string) =>
        set({ accessToken, refreshToken }),
      clearTokens: () => set({ accessToken: null, refreshToken: null }),
      isAuthenticated: () => get().accessToken !== null,
    }),
    {
      name: "server-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

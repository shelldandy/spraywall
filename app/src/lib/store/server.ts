import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

function parseUserId(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}

interface AuthState {
  serverUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
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
      userId: null,
      setServerUrl: (url: string) => set({ serverUrl: url }),
      setTokens: (accessToken: string, refreshToken: string) =>
        set({ accessToken, refreshToken, userId: parseUserId(accessToken) }),
      clearTokens: () => set({ accessToken: null, refreshToken: null, userId: null }),
      isAuthenticated: () => get().accessToken !== null,
    }),
    {
      name: "server-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

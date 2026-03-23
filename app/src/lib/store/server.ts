import { useState, useEffect } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

function parseUserId(token: string | null): string | null {
  if (!token) return null;
  try {
    let payload = token.split(".")[1];
    // Handle base64url encoding: replace URL-safe chars and add padding
    payload = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
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

export function useHasHydrated() {
  const [hasHydrated, setHasHydrated] = useState(
    useServerStore.persist.hasHydrated(),
  );
  useEffect(() => {
    const unsub = useServerStore.persist.onFinishHydration(() =>
      setHasHydrated(true),
    );
    return unsub;
  }, []);
  return hasHydrated;
}

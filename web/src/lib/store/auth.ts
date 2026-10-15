import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  setTokens: (accessToken: string, refreshToken: string) => void;
  clearTokens: () => void;
}

// Persisted to localStorage, which hydrates synchronously on load.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      userId: null,
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken, userId: parseUserId(accessToken) }),
      clearTokens: () => set({ accessToken: null, refreshToken: null, userId: null }),
    }),
    { name: "spraywall-auth" },
  ),
);

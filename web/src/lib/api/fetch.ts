import { useAuthStore } from "../store/auth";

// The API is served from the same origin, proxied by nginx (prod) or Vite (dev).
export const API_BASE = "/api";

/** fetch() that turns network failures into a readable message for toasts and error states. */
async function request(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error(
      navigator.onLine
        ? "Could not reach the server."
        : "You're offline. This needs a connection.",
    );
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const { refreshToken, setTokens, clearTokens } = useAuthStore.getState();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const { accessToken } = useAuthStore.getState();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  if (!headers["Content-Type"] && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await request(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && useAuthStore.getState().refreshToken) {
    // Deduplicate concurrent refresh attempts
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      const { accessToken: newToken } = useAuthStore.getState();
      headers["Authorization"] = `Bearer ${newToken}`;
      return request(`${API_BASE}${path}`, { ...options, headers });
    }
  }

  return res;
}

import { useServerStore } from "../store/server";

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const { serverUrl, refreshToken, setTokens, clearTokens } =
    useServerStore.getState();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${serverUrl}/auth/refresh`, {
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
  const { serverUrl, accessToken } = useServerStore.getState();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  if (!headers["Content-Type"] && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${serverUrl}${path}`, { ...options, headers });

  if (res.status === 401 && useServerStore.getState().refreshToken) {
    // Deduplicate concurrent refresh attempts
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      const { accessToken: newToken } = useServerStore.getState();
      headers["Authorization"] = `Bearer ${newToken}`;
      return fetch(`${serverUrl}${path}`, { ...options, headers });
    }
  }

  return res;
}

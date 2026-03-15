import { useServerStore } from "../store/server";

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
  return fetch(`${serverUrl}${path}`, { ...options, headers });
}

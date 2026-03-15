import createClient from "openapi-fetch";
import { useServerStore } from "../store/server";

// Create a function to get a configured client
export function getApiClient() {
  const { serverUrl, accessToken } = useServerStore.getState();

  const client = createClient<Record<string, never>>({
    baseUrl: serverUrl,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  return client;
}

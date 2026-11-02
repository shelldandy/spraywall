import type { Wall } from "../api/types";

type ApiFetch = (path: string) => Promise<Response>;

export async function fetchWalls(fetch: ApiFetch): Promise<Wall[]> {
  const response = await fetch("/walls");
  if (!response.ok) throw new Error(`Failed to fetch walls (HTTP ${response.status})`);
  return response.json();
}

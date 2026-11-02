import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/fetch";
import type { Wall } from "../api/types";
import { fetchWalls } from "./wallList";

export { fetchWalls };

export function useWalls(enabled = true) {
  return useQuery<Wall[]>({
    queryKey: ["walls"],
    queryFn: () => fetchWalls(apiFetch),
    enabled,
  });
}

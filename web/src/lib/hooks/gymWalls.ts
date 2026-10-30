import type { Gym, Wall } from "../api/types";

export interface GymWithWalls extends Gym {
  walls: Wall[];
}

type ApiFetch = (path: string) => Promise<Response>;

export async function fetchGymsWithWalls(apiFetch: ApiFetch): Promise<GymWithWalls[]> {
  const gymsRes = await apiFetch("/gyms");
  if (!gymsRes.ok) throw new Error("Failed to fetch gyms");
  const gyms: Gym[] = await gymsRes.json();

  return Promise.all(
    gyms.map(async (gym) => {
      const res = await apiFetch(`/gyms/${gym.slug}/walls`);
      if (!res.ok) {
        throw new Error(`Failed to fetch walls for ${gym.name} (${gym.slug}, HTTP ${res.status})`);
      }
      const walls: Wall[] = await res.json();
      return { ...gym, walls };
    }),
  );
}

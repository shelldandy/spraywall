import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { fetchGymsWithWalls } from "../src/lib/hooks/gymWalls.ts";

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("wall-list failures retain the last good cache and successful refetch replaces it", async () => {
  const gyms = [{ id: "gym-1", name: "North Gym", slug: "north" }];
  let wallResponse = response([]);
  const apiFetch = async (path) => path === "/gyms" ? response(gyms) : wallResponse;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ["gyms-with-walls"];
  const load = () => client.fetchQuery({
    queryKey,
    queryFn: () => fetchGymsWithWalls(apiFetch),
    staleTime: 0,
  });

  const initial = await load();
  assert.deepEqual(initial[0].walls, [], "an actual empty wall list is valid data");

  wallResponse = response({ error: "unavailable" }, 503);
  await assert.rejects(load(), /North Gym \(north, HTTP 503\)/);
  assert.deepEqual(client.getQueryData(queryKey), initial, "a failed refresh must not replace cached data with []");

  wallResponse = response([{ id: "wall-1", name: "Boulder", gym_id: "gym-1" }]);
  const refreshed = await load();
  assert.equal(refreshed[0].walls[0].id, "wall-1");
  client.clear();
});

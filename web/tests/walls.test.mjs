import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { fetchWalls } from "../src/lib/hooks/wallList.ts";

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("wall list failures retain the last successful cache", async () => {
  let result = response([{ id: "wall-1", name: "Boulder" }]);
  const apiFetch = async (path) => {
    assert.equal(path, "/walls");
    return result;
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ["walls"];
  const load = () => client.fetchQuery({ queryKey, queryFn: () => fetchWalls(apiFetch), staleTime: 0 });

  const initial = await load();
  assert.deepEqual(initial, [{ id: "wall-1", name: "Boulder" }]);
  result = response({ error: "unavailable" }, 503);
  await assert.rejects(load(), /Failed to fetch walls \(HTTP 503\)/);
  assert.deepEqual(client.getQueryData(queryKey), initial);
  client.clear();
});

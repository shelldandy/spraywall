import assert from "node:assert/strict";
import test from "node:test";
import { applyCircuit, parseRouteFilters, writeRouteFilters } from "../src/lib/routeFilters.ts";

test("circuit URL state normalizes repeated values and preserves unrelated search params", () => {
  const params = new URLSearchParams("circuit=%20bad%20&circuit=valid&wallId=w&gymSlug=g");
  const filters = parseRouteFilters(params);
  assert.equal(filters.circuit, "bad");
  const normalized = writeRouteFilters(params, filters);
  assert.deepEqual(normalized.getAll("circuit"), ["bad"]);
  assert.equal(normalized.get("wallId"), "w");
  assert.equal(normalized.get("gymSlug"), "g");
});

test("circuit application keeps saved route ordering and skips unavailable routes", () => {
  const routes = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(applyCircuit(routes, ["c", "missing", "a"]), [{ id: "c" }, { id: "a" }]);
});

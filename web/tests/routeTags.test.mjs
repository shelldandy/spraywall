import assert from "node:assert/strict";
import test from "node:test";
import { isRouteTagId, parseRouteTags, routeHasAnyTag, routeTags } from "../src/lib/routeTags.ts";

test("route tag IDs accept only known string values", () => {
  assert.equal(isRouteTagId("pumpy"), true);
  assert.equal(isRouteTagId("unknown"), false);
  assert.equal(isRouteTagId(12), false);
});

test("route tag parsing ignores unknowns and duplicates in canonical order", () => {
  assert.deepEqual(parseRouteTags(["technical", "pumpy", "unknown", "pumpy"]), ["pumpy", "technical"]);
  assert.deepEqual(parseRouteTags(null), []);
  assert.equal(routeTags.length, 12);
});

test("tag filtering matches any selected tag and keeps unfiltered routes", () => {
  assert.equal(routeHasAnyTag(["crimpy", "pumpy"], ["technical", "pumpy"]), true);
  assert.equal(routeHasAnyTag(["crimpy"], ["technical", "pumpy"]), false);
  assert.equal(routeHasAnyTag(undefined, []), true);
});

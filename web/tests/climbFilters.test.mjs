import assert from "node:assert/strict";
import test from "node:test";
import { canFlash, deriveProgress, formatCalendarDate, localCalendarDate } from "../src/lib/climbLogs.ts";
import { hasRouteFilters, hasRouteListParams, loadRouteListState, matchesRouteFilters, parseRouteFilters, parseRouteSort, ROUTE_LIST_KEYS, saveRouteListState, sortRoutes, writeRouteFilters, writeRouteSort } from "../src/lib/routeFilters.ts";

function route(overrides = {}) {
  return { grade: "V4", tags: ["crimpy"], progress: "not_tried", has_sent: false, rating_average: null, rating_count: 0, ...overrides };
}

function withSessionStorage(storage, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  try {
    callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else delete globalThis.sessionStorage;
  }
}

function mapSessionStorage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("derives progress from outcomes and keeps Flash a first activity", () => {
  assert.equal(deriveProgress([]), "not_tried");
  assert.equal(deriveProgress(["attempt"]), "projects");
  assert.equal(deriveProgress(["attempt", "flash"]), "sent");
  assert.equal(canFlash([]), true);
  assert.equal(canFlash(["attempt"]), false);
});

test("formats date-only values without shifting calendar day", () => {
  assert.equal(formatCalendarDate("2025-01-02", "en-US"), "Jan 2, 2025");
  const local = localCalendarDate(new Date(2025, 0, 2, 23, 59));
  assert.equal(local, "2025-01-02");
});

test("combines grade, style, progress, and unrounded community stars", () => {
  const filters = { tags: ["crimpy"], minGrade: "V3", maxGrade: "V5", progress: "projects", minStars: 4, circuit: null, hasBeta: false };
  assert.equal(matchesRouteFilters(route({ progress: "projects", rating_average: 4.01 }), filters), true);
  assert.equal(matchesRouteFilters(route({ progress: "projects", rating_average: 3.99 }), filters), false);
  assert.equal(matchesRouteFilters(route({ progress: "projects", rating_average: null }), filters), false);
  assert.equal(matchesRouteFilters(route({ progress: "sent", rating_average: 4.5 }), filters), false);
  assert.equal(matchesRouteFilters(route({ tags: ["pumpy"], progress: "projects", rating_average: 4.5 }), filters), false);
  assert.equal(matchesRouteFilters(route({ progress: "sent", has_sent: true }), { ...filters, tags: [], minGrade: null, maxGrade: null, progress: "unsent", minStars: null }), false);
  assert.equal(matchesRouteFilters(route({ progress: "projects" }), { ...filters, tags: [], minGrade: null, maxGrade: null, progress: "unsent", minStars: null }), true);
});

test("normalizes malformed and repeated URL values while preserving unrelated params", () => {
  const params = new URLSearchParams("tag=crimpy&tag=bad&tag=crimpy&minGrade=v5&maxGrade=V3&progress=bogus&progress=projects&minStars=9&minStars=4.0&wallId=w&other=value");
  const filters = parseRouteFilters(params);
  assert.deepEqual(filters, { tags: ["crimpy"], minGrade: "V5", maxGrade: null, progress: "projects", minStars: 4, circuit: null, hasBeta: false });
  const normalized = writeRouteFilters(new URLSearchParams(params), filters);
  assert.equal(normalized.getAll("tag").length, 1);
  assert.deepEqual(normalized.getAll("progress"), ["projects"]);
  assert.equal(normalized.get("minStars"), "4");
  assert.equal(normalized.get("wallId"), "w");
  assert.equal(normalized.get("other"), "value");
  assert.equal(hasRouteFilters(filters), true);
  assert.equal(hasRouteFilters(parseRouteFilters(new URLSearchParams("x=1"))), false);
  assert.equal(hasRouteFilters(parseRouteFilters(new URLSearchParams("sort=grade_asc"))), false);
});

test("Any rating includes unrated climbs, but active minimum excludes them", () => {
  const unrated = route({ rating_average: null });
  assert.equal(matchesRouteFilters(unrated, parseRouteFilters(new URLSearchParams())), true);
  assert.equal(matchesRouteFilters(unrated, { tags: [], minGrade: null, maxGrade: null, progress: null, minStars: 1, circuit: null, hasBeta: false }), false);
});

test("beta filter matches only routes with a reported video count", () => {
  const filters = parseRouteFilters(new URLSearchParams("beta=1"));
  assert.equal(matchesRouteFilters(route({ beta_video_count: 3 }), filters), true);
  assert.equal(matchesRouteFilters(route({ beta_video_count: 0 }), filters), false);
  assert.equal(matchesRouteFilters(route(), filters), false);
  assert.equal(hasRouteFilters(filters), true);
});

test("beta URL state round-trips and junk values are false", () => {
  const filters = parseRouteFilters(new URLSearchParams("beta=1"));
  const normalized = writeRouteFilters(new URLSearchParams("wallId=w"), filters);
  assert.equal(normalized.get("beta"), "1");
  assert.equal(parseRouteFilters(normalized).hasBeta, true);
  for (const value of ["0", "true", "yes", "junk"]) {
    assert.equal(parseRouteFilters(new URLSearchParams(`beta=${value}`)).hasBeta, false);
  }
});

test("grade sorting is directional, stable for ties, and leaves unknown grades last", () => {
  const routes = [
    { id: "new-v4", grade: "V4" },
    { id: "v2", grade: "V2" },
    { id: "old-v4", grade: "V4" },
    { id: "unknown", grade: "Mystery" },
    { id: "ungraded", grade: null },
    { id: "v0", grade: "V0" },
  ];
  assert.deepEqual(sortRoutes(routes, "grade_asc").map(({ id }) => id), ["v0", "v2", "new-v4", "old-v4", "unknown", "ungraded"]);
  assert.deepEqual(sortRoutes(routes, "grade_desc").map(({ id }) => id), ["new-v4", "old-v4", "v2", "v0", "unknown", "ungraded"]);
});

test("route sort URL state normalizes valid values and falls back to newest", () => {
  assert.equal(parseRouteSort(new URLSearchParams("sort=invalid")), "newest");
  assert.equal(parseRouteSort(new URLSearchParams("sort=grade_desc")), "grade_desc");
  const params = writeRouteSort(new URLSearchParams("wallId=w&sort=grade_asc"), "newest");
  assert.equal(params.has("sort"), false);
  assert.equal(params.get("wallId"), "w");
  assert.equal(writeRouteSort(new URLSearchParams(), "grade_asc").get("sort"), "grade_asc");
});

test("route list state round-trips only list parameters", () => {
  const storage = mapSessionStorage();
  withSessionStorage(storage, () => {
    const params = new URLSearchParams("tag=crimpy&tag=pinchy&minGrade=V2&maxGrade=V5&progress=projects&minStars=4&circuit=c-1&beta=1&sort=grade_desc&wallId=w&view=activity&gymSlug=gym");
    saveRouteListState("w", params);
    const loaded = loadRouteListState("w");
    assert.ok(loaded);
    assert.deepEqual([...new Set(loaded.keys())].sort(), [...ROUTE_LIST_KEYS].sort());
    assert.deepEqual(loaded.getAll("tag"), ["crimpy", "pinchy"]);
    assert.equal(loaded.get("sort"), "grade_desc");
    assert.equal(loaded.has("wallId"), false);
    assert.equal(loaded.has("view"), false);
    assert.equal(loaded.has("gymSlug"), false);
    saveRouteListState("w", new URLSearchParams("wallId=w&view=activity"));
    assert.equal(storage.values.get("spraywall:route-list:w"), "");
    assert.equal(loadRouteListState("w")?.toString(), "");
  });
});

test("route list state load handles missing and unavailable storage", () => {
  withSessionStorage(mapSessionStorage(), () => assert.equal(loadRouteListState("missing"), null));
  withSessionStorage({ getItem() { throw new Error("storage unavailable"); } }, () => {
    assert.equal(loadRouteListState("w"), null);
  });
});

test("hasRouteListParams recognizes every list key only", () => {
  for (const key of ROUTE_LIST_KEYS) assert.equal(hasRouteListParams(new URLSearchParams(`${key}=x`)), true, key);
  assert.equal(hasRouteListParams(new URLSearchParams("wallId=w&view=activity&gymSlug=gym")), false);
});

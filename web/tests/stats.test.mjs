import assert from "node:assert/strict";
import test from "node:test";
import {
  gradeBuckets,
  heatColor,
  holdCoverage,
  personalStats,
} from "../src/lib/stats.ts";

const entry = (id, route, outcome, date, grade = "V2", wall = "w1") => ({
  id,
  route_id: route,
  outcome,
  climbed_on: date,
  logged_at: date,
  notes: null,
  attempts: null,
  route_grade: grade,
  wall_id: wall,
});

test("heatColor maps empty and increasing activity to heat levels", () => {
  assert.equal(heatColor(0), "var(--bg-muted)");
  assert.notEqual(heatColor(1), heatColor(4));
  assert.equal(heatColor(100), heatColor(4));
});

test("gradeBuckets sorts rows by V grade and puts unknown or ungraded last", () => {
  const rows = [
    { grade: "V3", climbs: 3 },
    { grade: null, climbs: 0 },
    { grade: "mystery", climbs: 1 },
    { grade: "V10", climbs: 6 },
    { grade: "V1", climbs: 2 },
    { grade: "V3", climbs: 4 },
    { grade: "V4", climbs: 5 },
  ];
  assert.deepEqual(gradeBuckets(rows), [
    rows[4],
    rows[0],
    rows[5],
    rows[6],
    rows[3],
    rows[1],
    rows[2],
  ]);
});

test("personalStats scopes wall, distinct sent routes, flashes, calendar and weekly streaks", () => {
  const entries = [
    entry("1", "a", "flash", "2025-03-03", "V3"),
    entry("2", "a", "send", "2025-03-04", "V3"),
    entry("3", "b", "attempt", "2025-03-10", "V5"),
    entry("4", "c", "flash", "2025-03-10", "V5", "w2"),
    entry("5", "d", "send", "2025-03-11", "mystery"),
  ];
  const result = personalStats(entries, "w1", new Date("2025-03-12T12:00:00Z"));
  assert.deepEqual(result.totals, {
    sends: 2,
    flashes: 1,
    attempts: 1,
    unique_climbs_sent: 2,
    days_climbed: 4,
    flash_rate: 1 / 3,
    hardest_send: "V3",
  });
  assert.deepEqual(result.pyramid, [
    { grade: "V3", sends: 0, flashes: 1 },
    { grade: "mystery", sends: 1, flashes: 0 },
  ]);
  assert.equal(result.calendar.length, 182);
  assert.equal(result.streaks.current, 2);
  assert.equal(result.streaks.longest, 2);
  assert.deepEqual(result.hardest_by_month.at(-1), {
    month: "2025-03",
    grade: "V3",
  });
});

test("personalStats uses the user's local date for month and current-week boundaries", () => {
  const oldTimezone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const sunday = personalStats(
      [entry("1", "a", "send", "2025-03-02")],
      undefined,
      new Date("2025-03-03T07:30:00Z"),
    );
    assert.equal(sunday.streaks.current, 1);
    const monthEnd = personalStats(
      [entry("2", "b", "send", "2025-02-28")],
      undefined,
      new Date("2025-03-01T07:30:00Z"),
    );
    assert.equal(monthEnd.hardest_by_month.at(-1).month, "2025-02");
    assert.equal(
      monthEnd.calendar.find((day) => day.date === "2025-02-28").count,
      1,
    );
  } finally {
    if (oldTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = oldTimezone;
  }
});

test("holdCoverage counts holds used by sent routes, preferring active holds", () => {
  const holds = ["a", "b", "c"].map((id) => ({
    id,
    wall_image_id: "image",
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    polygon: null,
    confidence: 1,
  }));
  const routes = [
    { has_sent: true, hold_ids: ["a", "b"], active_hold_ids: ["b"] },
    { has_sent: false, hold_ids: ["c"] },
  ];
  assert.deepEqual(holdCoverage(holds, routes), {
    holds: [
      { hold_id: "a", covered: false },
      { hold_id: "b", covered: true },
      { hold_id: "c", covered: false },
    ],
    covered: 1,
    total: 3,
    percentage: 1 / 3,
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { calendarParts, formatRelativeTime } from "../src/lib/climbLogs.ts";

test("date-only relative time uses UTC calendar dates", () => {
  const now = new Date("2025-03-05T18:30:00Z");
  assert.equal(formatRelativeTime("2025-03-02", now, "en"), "3 days ago");
  assert.equal(formatRelativeTime("2025-03-06", now, "en"), "tomorrow");
});

test("timestamp relative time uses instants across timezone offsets", () => {
  const now = new Date("2025-03-06T00:30:00Z");
  assert.equal(formatRelativeTime("2025-03-05T18:00:00-06:00", now, "en"), "30 minutes ago");
  assert.equal(formatRelativeTime("2025-03-03T00:30:00Z", now, "en"), "3 days ago");
});

test("calendar badge parts follow the YYYY-MM-DD date in UTC", () => {
  assert.deepEqual(calendarParts("2025-03-03", "en"), {
    weekday: "Mon",
    day: "3",
    month: "Mar",
  });
  assert.deepEqual(calendarParts("not-a-date", "en"), {
    weekday: "",
    day: "not-a-date",
    month: "",
  });
});

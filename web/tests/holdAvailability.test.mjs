import assert from "node:assert/strict";
import test from "node:test";
import { canEditWallHolds, shouldLoadHolds } from "../src/lib/hooks/holdAvailability.ts";

test("holds load only after detection completes, or for setters after terminal failure", () => {
  assert.equal(shouldLoadHolds("pending", "setter"), false);
  assert.equal(shouldLoadHolds("processing", "admin"), false);
  assert.equal(shouldLoadHolds("done", "climber"), true);
  assert.equal(shouldLoadHolds("failed", "setter"), true);
  assert.equal(shouldLoadHolds("failed", "admin"), true);
  assert.equal(shouldLoadHolds("failed", "climber"), false);
  assert.equal(shouldLoadHolds(null, "admin"), false);
});

test("manual hold editing waits for terminal detection and a current image", () => {
  assert.equal(canEditWallHolds("pending", "setter", true), false);
  assert.equal(canEditWallHolds("done", "setter", true), true);
  assert.equal(canEditWallHolds("failed", "setter", true), true);
  assert.equal(canEditWallHolds("failed", "admin", true), true);
  assert.equal(canEditWallHolds("failed", "climber", true), false);
  assert.equal(canEditWallHolds("failed", "setter", false), false);
  assert.equal(canEditWallHolds(null, "admin", false), false);
});

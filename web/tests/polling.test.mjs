import assert from "node:assert/strict";
import test from "node:test";
import { POLL_INTERVAL_MS, isDetecting, wallDetailPollInterval } from "../src/lib/hooks/polling.ts";

test("wall detail polling includes pending-reset work only when enabled", () => {
  assert.equal(isDetecting("pending"), true);
  assert.equal(isDetecting("processing"), true);
  assert.equal(isDetecting("failed"), false);
  assert.equal(wallDetailPollInterval("pending", null), POLL_INTERVAL_MS);
  assert.equal(wallDetailPollInterval("done", "processing"), false);
  assert.equal(wallDetailPollInterval("done", "processing", true), POLL_INTERVAL_MS);
  assert.equal(wallDetailPollInterval("done", "failed", true), false);
});

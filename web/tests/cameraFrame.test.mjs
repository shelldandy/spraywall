import assert from "node:assert/strict";
import test from "node:test";
import { cropToAspect, getContainedFrame, streamSize } from "../src/lib/cameraFrame.ts";

function assertFrame(actual, expected) {
  for (const key of Object.keys(expected)) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} !== ${expected[key]}`);
  }
}

test("contains a portrait frame in a tall stage", () => {
  assertFrame(getContainedFrame(400, 800, 3 / 4), {
    left: 0,
    top: 400 / 3,
    width: 400,
    height: 1600 / 3,
  });
});

test("contains a landscape frame in a wide stage", () => {
  assertFrame(getContainedFrame(800, 400, 4 / 3), {
    left: 400 / 3,
    top: 0,
    width: 1600 / 3,
    height: 400,
  });
});

test("returns an empty frame for zero sizes", () => {
  assert.deepEqual(getContainedFrame(0, 400, 3 / 4), {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
});

test("crops a square to portrait aspect", () => {
  assert.deepEqual(cropToAspect(1000, 1000, 3 / 4), {
    left: 125,
    top: 0,
    width: 750,
    height: 1000,
  });
});

test("crops a landscape frame to portrait aspect", () => {
  assert.deepEqual(cropToAspect(1200, 900, 3 / 4), {
    left: 262.5,
    top: 0,
    width: 675,
    height: 900,
  });
});

test("leaves a matching frame uncropped", () => {
  assert.deepEqual(cropToAspect(300, 400, 3 / 4), {
    left: 0,
    top: 0,
    width: 300,
    height: 400,
  });
});

test("sizes portrait streams with the long side at the requested size", () => {
  assert.deepEqual(streamSize(3 / 4, 1920), {
    width: { ideal: 1440 },
    height: { ideal: 1920 },
    aspectRatio: { ideal: 3 / 4 },
  });
});

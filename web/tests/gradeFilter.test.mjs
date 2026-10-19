import assert from "node:assert/strict";
import test from "node:test";
import { getVGradeRank, isVGradeWithinRange } from "../src/lib/grades.ts";

test("ranks V grades in canonical climbing order", () => {
  assert.equal(getVGradeRank("VB"), 0);
  assert.equal(getVGradeRank("V0"), 1);
  assert.equal(getVGradeRank("V5"), 6);
  assert.equal(getVGradeRank("V9"), 10);
  assert.equal(getVGradeRank("V10"), 11);
  assert.equal(getVGradeRank("V17"), 18);
});

test("matches inclusive ranges without lexical grade comparisons", () => {
  assert.equal(isVGradeWithinRange("VB", "VB", "V0"), true);
  assert.equal(isVGradeWithinRange("V0", "VB", "V0"), true);
  assert.equal(isVGradeWithinRange("V1", "VB", "V0"), false);
  assert.equal(isVGradeWithinRange("V9", "V9", "V10"), true);
  assert.equal(isVGradeWithinRange("V10", "V9", "V10"), true);
  assert.equal(isVGradeWithinRange("V11", "V9", "V10"), false);
});

test("supports open-ended and equal-grade ranges", () => {
  assert.equal(isVGradeWithinRange("VB", null, "V0"), true);
  assert.equal(isVGradeWithinRange("V17", "V16", null), true);
  assert.equal(isVGradeWithinRange("V15", "V16", null), false);
  assert.equal(isVGradeWithinRange("V4", "V4", "V4"), true);
  assert.equal(isVGradeWithinRange("V3", "V4", "V4"), false);
});

test("retains ungraded grades only when no bounds are active", () => {
  assert.equal(isVGradeWithinRange(null), true);
  assert.equal(isVGradeWithinRange("unknown"), true);
  assert.equal(isVGradeWithinRange(null, "VB"), false);
  assert.equal(isVGradeWithinRange("unknown", null, "V17"), false);
});

test("normalizes grade values for comparison", () => {
  assert.equal(getVGradeRank(" v10 "), 11);
  assert.equal(isVGradeWithinRange(" v5 ", "V4", "V6"), true);
  assert.equal(getVGradeRank("V18"), null);
});

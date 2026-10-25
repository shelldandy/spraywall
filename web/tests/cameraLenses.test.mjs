import assert from "node:assert/strict";
import test from "node:test";
import { lensLabel } from "../src/lib/cameraLenses.ts";

test("classifies English and Spanish rear camera labels", () => {
  assert.equal(lensLabel("Back Camera"), "1x");
  assert.equal(lensLabel("Cámara trasera"), "1x");
  assert.equal(lensLabel("Back Ultra Wide"), "0.5x");
  assert.equal(lensLabel("Cámara ultra gran angular posterior"), "0.5x");
  assert.equal(lensLabel("Telephoto"), "Tele");
  assert.equal(lensLabel("Téléobjectif"), "Tele");
});

test("filters front-facing and virtual multi-camera labels", () => {
  assert.equal(lensLabel("Front Camera"), null);
  assert.equal(lensLabel("Cámara frontal"), null);
  assert.equal(lensLabel("Back Dual"), null);
  assert.equal(lensLabel("Cámara posterior doble"), null);
  assert.equal(lensLabel("Back Dual Wide"), null);
  assert.equal(lensLabel("Cámara amplia doble posterior"), null);
});

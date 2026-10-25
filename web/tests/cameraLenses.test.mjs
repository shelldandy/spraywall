import assert from "node:assert/strict";
import test from "node:test";
import { filterAmbiguousWideLenses, lensLabel } from "../src/lib/cameraLenses.ts";

test("classifies English and Spanish rear camera labels", () => {
  assert.equal(lensLabel("Back Camera"), "1x");
  assert.equal(lensLabel("Cámara trasera"), "1x");
  assert.equal(lensLabel("Back Ultra Wide"), "0.5x");
  assert.equal(lensLabel("Cámara ultra gran angular posterior"), "0.5x");
  assert.equal(lensLabel("Telephoto"), "Tele");
  assert.equal(lensLabel("Téléobjectif"), "Tele");
});

test("keeps the explicit rear camera when labels produce multiple 1x candidates", () => {
  const candidates = [
    { name: "Cámara trasera", label: lensLabel("Cámara trasera"), deviceId: "rear" },
    {
      name: "Cámara amplia de dos lentes",
      label: lensLabel("Cámara amplia de dos lentes"),
      deviceId: "ambiguous",
    },
    {
      name: "Cámara ultra gran angular posterior",
      label: lensLabel("Cámara ultra gran angular posterior"),
      deviceId: "ultra",
    },
  ];

  assert.deepEqual(
    filterAmbiguousWideLenses(candidates).map((lens) => lens.deviceId),
    ["rear", "ultra"],
  );
});

test("drops ambiguous 1x candidates when none identifies a rear camera", () => {
  const candidates = [
    { name: "Main Camera", label: lensLabel("Main Camera"), deviceId: "main" },
    {
      name: "Cámara amplia de dos lentes",
      label: lensLabel("Cámara amplia de dos lentes"),
      deviceId: "other",
    },
  ];

  assert.deepEqual(filterAmbiguousWideLenses(candidates), []);
});

test("filters front-facing and virtual multi-camera labels", () => {
  assert.equal(lensLabel("Front Camera"), null);
  assert.equal(lensLabel("Cámara frontal"), null);
  assert.equal(lensLabel("Back Dual"), null);
  assert.equal(lensLabel("Cámara posterior doble"), null);
  assert.equal(lensLabel("Back Dual Wide"), null);
  assert.equal(lensLabel("Cámara amplia doble posterior"), null);
});

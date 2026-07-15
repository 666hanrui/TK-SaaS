import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticColorBandsPng } from "../src/vision/syntheticTestImage.js";

test("synthetic vision image is a non-empty PNG with the expected dimensions", () => {
  const image = createSyntheticColorBandsPng();
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 360);
  assert.equal(image.readUInt32BE(20), 180);
  assert.ok(image.length > 500);
});

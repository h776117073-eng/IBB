import test from "node:test";
import assert from "node:assert/strict";
import { parseBbox, clusterStep, classifyEntityKind } from "../src/directory-catalog.js";

test("map bounding box accepts a valid Ibb viewport", () => {
  assert.deepEqual(parseBbox("44.05,13.82,44.32,14.08"), {
    west: 44.05, south: 13.82, east: 44.32, north: 14.08
  });
});

test("map bounding box rejects malformed, inverted and oversized viewports", () => {
  assert.equal(parseBbox("44,14,44"), null);
  assert.equal(parseBbox("44.3,13.8,44.1,14"), null);
  assert.equal(parseBbox("40,10,45,15"), null);
});

test("map clustering becomes more granular as zoom increases", () => {
  assert.ok(clusterStep(10) > clusterStep(12));
  assert.ok(clusterStep(12) > clusterStep(14));
  assert.equal(clusterStep(16), 0);
});

test("Arabic map entity classifier distinguishes streets, neighborhoods and places", () => {
  assert.equal(classifyEntityKind("شارع تعز", ""), "STREET");
  assert.equal(classifyEntityKind("حارة الجامع", ""), "NEIGHBORHOOD");
  assert.equal(classifyEntityKind("الجامع الكبير", ""), "LANDMARK");
  assert.equal(classifyEntityKind("مستشفى الثورة", ""), "PUBLIC_SERVICE");
  assert.equal(classifyEntityKind("صيدلية الشفاء", ""), "BUSINESS");
});

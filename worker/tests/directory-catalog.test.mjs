import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseBbox, clusterStep, classifyEntityKind, validateGoogleMapsArchiveCandidate, classifyGoogleMapsArchiveConflicts } from "../src/directory-catalog.js";

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


function safeArchiveCandidate(overrides = {}) {
  const placeId = "ChIJAbcdefghijklmnop";
  const id = "gmaps-" + createHash("sha256").update(placeId).digest("hex").slice(0, 24);
  return {
    id,
    source_file: "verified_ibb_registry.xlsx",
    source_record_id: "unique-sheet-row-1",
    name: "صيدلية الشفاء",
    name_norm: "صيدلية الشفاء",
    kind: "BUSINESS",
    category: "صيدلية",
    operational_status: "UNKNOWN",
    latitude: 13.975,
    longitude: 44.178,
    geometry_type: "POINT",
    location_precision: "APPROXIMATE",
    identity_status: "UNVERIFIED",
    location_status: "APPROXIMATE",
    verification_status: "UNVERIFIED",
    visibility_status: "NEEDS_REVIEW",
    is_commercial: 1,
    is_public: 0,
    place_id: placeId,
    source_name: "GOOGLE_MAPS_ARCHIVE_WORKBOOK",
    source_status: "ARCHIVE_EXTRACTED_NOT_INDEPENDENTLY_REVIEWED",
    source_hash: "a".repeat(64),
    ...overrides
  };
}

test("Google Maps archive candidates pass only with the restricted review state", async () => {
  assert.deepEqual(await validateGoogleMapsArchiveCandidate(safeArchiveCandidate()), { ok: true, sequence: 1 });
});

test("Google Maps archive importer rejects other sources and unsafe publication states", async () => {
  assert.equal((await validateGoogleMapsArchiveCandidate(safeArchiveCandidate({ source_name: "RAW_16441" }))).ok, false);
  assert.equal((await validateGoogleMapsArchiveCandidate(safeArchiveCandidate({ verification_status: "VERIFIED_MATCH" }))).ok, false);
  assert.equal((await validateGoogleMapsArchiveCandidate(safeArchiveCandidate({ visibility_status: "PUBLISHED", is_public: 1 }))).ok, false);
  assert.equal((await validateGoogleMapsArchiveCandidate(safeArchiveCandidate({ is_public: 1 }))).ok, false);
  assert.equal((await validateGoogleMapsArchiveCandidate(safeArchiveCandidate({ source_file: "other.xlsx" }))).ok, false);
  assert.equal((await validateGoogleMapsArchiveCandidate(safeArchiveCandidate({ place_id: "ChIJdifferent123456" }))).ok, false);
});

test("Google Maps archive importer rejects unquarantined or invalid coordinates", async () => {
  assert.equal((await validateGoogleMapsArchiveCandidate(safeArchiveCandidate({
    location_status: "MISSING", location_precision: "MISSING", latitude: 13.975, longitude: 44.178
  }))).ok, false);
  assert.equal((await validateGoogleMapsArchiveCandidate(safeArchiveCandidate({ latitude: 15.0 }))).ok, false);
  assert.equal((await validateGoogleMapsArchiveCandidate(safeArchiveCandidate({ source_record_id: "unique-sheet-row-7016" }))).ok, false);
});


test("Google Maps archive batch skips only an existing identical row identity without updating it", () => {
  const row = safeArchiveCandidate();
  const existing = {
    id: row.id,
    source_file: row.source_file,
    source_record_id: row.source_record_id,
    place_id: row.place_id,
    source_hash: row.source_hash
  };
  const plan = classifyGoogleMapsArchiveConflicts([row], [existing]);
  assert.equal(plan.ok, true);
  assert.equal(plan.newRows.length, 0);
  assert.equal(plan.skippedExisting, 1);
  assert.equal(plan.skippedChangedSourceHash, 0);
});

test("Google Maps archive batch records changed-source conflicts as skipped without overwriting", () => {
  const row = safeArchiveCandidate();
  const existing = {
    id: row.id,
    source_file: row.source_file,
    source_record_id: row.source_record_id,
    place_id: row.place_id,
    source_hash: "b".repeat(64)
  };
  const plan = classifyGoogleMapsArchiveConflicts([row], [existing]);
  assert.equal(plan.ok, true);
  assert.equal(plan.newRows.length, 0);
  assert.equal(plan.skippedExisting, 1);
  assert.equal(plan.skippedChangedSourceHash, 1);
});

test("Google Maps archive batch rejects a source row already assigned to another Place ID", () => {
  const row = safeArchiveCandidate();
  const existing = {
    id: "gmaps-" + "0".repeat(24),
    source_file: row.source_file,
    source_record_id: row.source_record_id,
    place_id: "ChIJotherExistingPlace123",
    source_hash: "c".repeat(64)
  };
  const plan = classifyGoogleMapsArchiveConflicts([row], [existing]);
  assert.equal(plan.ok, false);
  assert.equal(plan.conflicts[0].reason, "SOURCE_ROW_ALREADY_LINKED_TO_DIFFERENT_PLACE");
});

test("Google Maps archive batch rejects an existing Place ID attached to another source row", () => {
  const row = safeArchiveCandidate();
  const existing = {
    id: row.id,
    source_file: row.source_file,
    source_record_id: "unique-sheet-row-2",
    place_id: row.place_id,
    source_hash: row.source_hash
  };
  const plan = classifyGoogleMapsArchiveConflicts([row], [existing]);
  assert.equal(plan.ok, false);
  assert.equal(plan.conflicts[0].reason, "PLACE_ID_ALREADY_LINKED_TO_DIFFERENT_SOURCE_ROW");
});

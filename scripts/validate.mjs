import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const index = readJson("data/index.json");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

if (!Array.isArray(index.chunks) || index.chunks.length < 1) {
  throw new Error("data/index.json must contain a non-empty chunks array");
}
if (!Array.isArray(index.importedFields) || index.importedFields.length !== 1 || index.importedFields[0] !== "name") {
  throw new Error("Dataset metadata must declare only the name field as imported");
}
const safeChunk = /^store-names-\d{3}\.json$/;
const seenFiles = new Set();
const names = [];
let blankNames = 0;

for (const file of index.chunks) {
  if (typeof file !== "string" || !safeChunk.test(file) || seenFiles.has(file)) {
    throw new Error("Invalid or duplicate chunk filename: " + String(file));
  }
  seenFiles.add(file);
  const chunk = readJson(path.posix.join("data", file));
  if (!Array.isArray(chunk)) throw new Error(file + " must contain a JSON array");
  for (const value of chunk) {
    if (typeof value !== "string") throw new Error(file + " includes a non-string field");
    if (!value.trim()) blankNames += 1;
    names.push(value);
  }
}

const normalise = (value) => value.normalize("NFKC").trim().replace(/\s+/g, " ");
const uniqueNames = new Set(names.map(normalise));
if (names.length !== index.totalRecords) {
  throw new Error("Record count mismatch: expected " + index.totalRecords + ", found " + names.length);
}
if (blankNames) throw new Error("Blank names found: " + blankNames);
if (uniqueNames.size !== names.length) {
  throw new Error("Repeated normalized names found: " + (names.length - uniqueNames.size));
}

const profileDir = path.join(root, "data/verified-profiles");
let verifiedProfileSummary = null;
if (fs.existsSync(profileDir)) {
  const profileIndexPath = path.join(profileDir, "index.json");
  if (!fs.existsSync(profileIndexPath)) throw new Error("Verified profile directory exists without index.json");
  const profileIndex = readJson("data/verified-profiles/index.json");
  if (profileIndex.schemaVersion !== 1 || profileIndex.recordKey !== "record_id" ||
      profileIndex.coordinatesImported !== false || profileIndex.placeIdIsUnique !== false) {
    throw new Error("Verified profile index must declare schema 1, record_id key, no imported coordinates, and non-unique Place IDs");
  }
  if (Number(profileIndex.totalRecords) !== names.length || !Array.isArray(profileIndex.chunks) || !profileIndex.chunks.length) {
    throw new Error("Verified profile count/chunks do not match the base name dataset");
  }
  const seenProfileFiles = new Set();
  const seenRecordIds = new Set();
  const seenSourceNames = new Set();
  let profileCount = 0;
  for (const file of profileIndex.chunks) {
    if (typeof file !== "string" || !/^verified-profiles-\d{3}\.json$/.test(file) || seenProfileFiles.has(file)) {
      throw new Error("Invalid or duplicate verified-profile chunk: " + String(file));
    }
    seenProfileFiles.add(file);
    const rows = readJson(path.posix.join("data/verified-profiles", file));
    if (!Array.isArray(rows)) throw new Error(file + " must contain a JSON array");
    for (const row of rows) {
      const n = Number(row.record_number);
      if (!Number.isInteger(n) || n !== profileCount + 1 || n > names.length) {
        throw new Error("Verified profile record_number sequence is invalid at " + (profileCount + 1));
      }
      if (!row.record_id || seenRecordIds.has(row.record_id)) throw new Error("Blank or duplicate verified record_id");
      if (!row.source_name || seenSourceNames.has(normalise(row.source_name))) throw new Error("Blank or duplicate verified source_name");
      if (normalise(row.source_name) !== normalise(names[n - 1])) throw new Error("Verified source_name does not match base dataset at row " + n);
      if (!row.verified_name || row.review_status !== "match") throw new Error("Verified profile has blank name or non-match review status at row " + n);
      if (Object.hasOwn(row, "latitude") || Object.hasOwn(row, "longitude") || Object.hasOwn(row, "lat") || Object.hasOwn(row, "lng")) {
        throw new Error("Verified CSV must not fabricate geographic coordinates");
      }
      for (const field of ["external_url", "maps_search_url"]) {
        if (row[field]) {
          const u = new URL(row[field]);
          if (!["http:", "https:"].includes(u.protocol)) throw new Error("Unsafe " + field + " in verified record " + n);
        }
      }
      seenRecordIds.add(row.record_id);
      seenSourceNames.add(normalise(row.source_name));
      profileCount++;
    }
  }
  if (profileCount !== Number(profileIndex.totalRecords) || seenRecordIds.size !== profileCount || seenSourceNames.size !== profileCount) {
    throw new Error("Verified profile import is incomplete or has duplicate keys");
  }
  verifiedProfileSummary = {
    records: profileCount,
    chunks: seenProfileFiles.size,
    uniqueRecordIds: seenRecordIds.size,
    repeatedPlaceIdsAllowed: true,
    coordinatesImported: false
  };
}

const inlineScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/i);
if (!inlineScript) throw new Error("Inline application script not found");
new vm.Script(inlineScript[1], { filename: "index.html:inline-script" });

const manifest = readJson("manifest.webmanifest");
if (!manifest.name || !manifest.start_url || manifest.display !== "standalone") {
  throw new Error("PWA manifest is missing required values");
}
if (!html.includes('href="./manifest.webmanifest"') || !html.includes("navigator.serviceWorker.register('./sw.js')")) {
  throw new Error("PWA manifest or service-worker registration is missing from the page");
}

console.log(JSON.stringify({
  status: "passed",
  nameRecords: names.length,
  chunkFiles: index.chunks.length,
  blankNames,
  normalizedDuplicates: names.length - uniqueNames.size,
  importedFields: index.importedFields,
  javascriptSyntax: "passed",
  manifest: "passed"
}, null, 2));

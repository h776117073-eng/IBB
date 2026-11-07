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

const inlineScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/i);
if (!inlineScript) throw new Error("Inline application script not found");
new vm.Script(inlineScript[1], { filename: "index.html:inline-script" });

const keyOfMatch = inlineScript[1].match(/function keyOf\(v\)\s*\{[\s\S]*?\n      \}/);
const searchFoldMatch = inlineScript[1].match(/function searchFold\(v\)\s*\{[\s\S]*?\n      \}/);
const searchRelevanceMatch = inlineScript[1].match(/function searchRelevance\(name, query\)\s*\{[\s\S]*?\n      \}/);
if (!keyOfMatch || !searchFoldMatch || !searchRelevanceMatch) {
  throw new Error("Arabic search helpers or relevance ranking are missing from index.html");
}
const searchHelpers = vm.runInNewContext([
  keyOfMatch[0],
  searchFoldMatch[0],
  searchRelevanceMatch[0],
  "({ keyOf, searchFold, searchRelevance })"
].join("\n"), { String, Number });
const exactScore = searchHelpers.searchRelevance("بقالة الورافي", "بقالة الورافي");
const prefixScore = searchHelpers.searchRelevance("بقالة الورافي", "بقالة");
const partialScore = searchHelpers.searchRelevance("بقالة الورافي", "الورافي");
if (!(exactScore > prefixScore && prefixScore > partialScore && partialScore > 0)) {
  throw new Error("Search relevance ordering failed: " + JSON.stringify({ exactScore, prefixScore, partialScore }));
}
if (searchHelpers.searchRelevance("بقالة الورافي", "صيدلية") !== 0) {
  throw new Error("Non-matching query should have zero relevance");
}
if (searchHelpers.searchFold("آية") !== "ايه") {
  throw new Error("Arabic normalization smoke test failed");
}

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

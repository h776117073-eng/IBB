import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const index = readJson("data/index.json");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const trustSql = fs.readFileSync(path.join(root, "supabase/migrations/20261021100000_merchant_trust_moderation.sql"), "utf8");

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


const blockedTokensMatch = inlineScript[1].match(/const blockedModerationTokens = new Set\(\[[\s\S]*?\]\);/);
const moderationNormaliseMatch = inlineScript[1].match(/function normalizeModerationText\(value\)\s*\{[\s\S]*?\n      \}/);
const moderateTextMatch = inlineScript[1].match(/function validateUserText\(value, fieldName, required, maxLength\)\s*\{[\s\S]*?\n      \}/);
const imageUrlMatch = inlineScript[1].match(/function validateSafeImageUrl\(value\)\s*\{[\s\S]*?\n      \}/);
const badgeMatch = inlineScript[1].match(/function getStoreVerificationBadge\(store\)\s*\{[\s\S]*?\n      \}/);
const coordsMatch = inlineScript[1].match(/function parseCoordinateInput\(value\)\s*\{[\s\S]*?\n      \}/);
if (!blockedTokensMatch || !moderationNormaliseMatch || !moderateTextMatch || !imageUrlMatch || !badgeMatch || !coordsMatch) {
  throw new Error("Store moderation, image gate, badge authority or coordinates helpers are missing");
}
const trustHelpers = vm.runInNewContext([
  blockedTokensMatch[0], moderationNormaliseMatch[0], moderateTextMatch[0],
  imageUrlMatch[0], badgeMatch[0], coordsMatch[0],
  "({ validateUserText, validateSafeImageUrl, getStoreVerificationBadge, parseCoordinateInput })"
].join("\n"), { URL });
if (!trustHelpers.validateUserText("بقالة الورافي", "اسم المتجر", true, 120).ok) {
  throw new Error("Legitimate Arabic store name should pass local text screening");
}
if (trustHelpers.validateUserText("متجر قحبة", "اسم المتجر", true, 120).ok) {
  throw new Error("Blocked explicit content word passed local text screening");
}
if (trustHelpers.validateUserText("<script>alert(1)</script>", "اسم المتجر", true, 120).ok) {
  throw new Error("HTML markup passed store-name screening");
}
if (trustHelpers.validateSafeImageUrl("http://example.com/image.jpg").ok) {
  throw new Error("HTTP image URL should be rejected");
}
if (trustHelpers.validateSafeImageUrl("https://192.168.1.5/image.jpg").ok) {
  throw new Error("Private-network image URL should be rejected");
}
if (!trustHelpers.validateSafeImageUrl("https://example.com/image.webp").ok) {
  throw new Error("Ordinary HTTPS image URL should pass preliminary URL checks");
}
const parsedCoords = trustHelpers.parseCoordinateInput("https://www.google.com/maps/@13.9667,44.1833,17z");
if (!parsedCoords || Math.abs(parsedCoords.lat - 13.9667) > 0.000001 || Math.abs(parsedCoords.lng - 44.1833) > 0.000001) {
  throw new Error("Google Maps coordinate extraction smoke test failed");
}
const localFakeGreen = trustHelpers.getStoreVerificationBadge({
  recordAuthority: "local-demo", verificationStatus: "verified",
  ownerIdentityVerified: true, verifiedAt: "2026-10-21T00:00:00Z",
  identityReviewAuthority: "approved"
});
if (localFakeGreen.state === "verified") {
  throw new Error("A local record must never receive the verified green badge");
}
const serverGreen = trustHelpers.getStoreVerificationBadge({
  recordAuthority: "ibb-server", verificationStatus: "verified",
  ownerIdentityVerified: true, verifiedAt: "2026-10-21T00:00:00Z",
  identityReviewAuthority: "approved"
});
if (serverGreen.state !== "verified" || serverGreen.className !== "green") {
  throw new Error("Green badge should require server-authoritative identity verification");
}
if (trustHelpers.getStoreVerificationBadge({webEvidenceStatus: "found"}).className !== "yellow") {
  throw new Error("Found web evidence should get the yellow review state");
}
if (trustHelpers.getStoreVerificationBadge({webEvidenceStatus: "not_found"}).className !== "red") {
  throw new Error("No web result should get the red verification-pending state");
}


const requiredTrustSql = [
  "alter table public.stores enable row level security",
  "alter table public.store_claims enable row level security",
  "alter table public.media_assets enable row level security",
  "grant select on public.stores to anon, authenticated",
  "stores_verified_guard",
  "verification_status = 'verified'",
  "owner_identity_verified = true",
  "moderation_status = 'approved'",
  "grant select, insert on public.media_assets to authenticated"
];
for (const fragment of requiredTrustSql) {
  if (!trustSql.includes(fragment)) {
    throw new Error("Trust-schema security invariant is missing: " + fragment);
  }
}
if (!trustSql.includes("grant update (name, name_key, category, description, public_phone, website_url, address_text, latitude, longitude, location_source)") ||
    trustSql.includes("grant update on public.stores to authenticated")) {
  throw new Error("Store profile grants are not restricted to approved public-profile columns");
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

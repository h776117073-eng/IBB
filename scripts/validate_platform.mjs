import fs from "node:fs";
import assert from "node:assert/strict";

const required = [
  "map/index.html",
  "map/app.js",
  "map/styles.css",
  "worker/src/directory-catalog.js",
  "worker/src/payments/adapter.js",
  "worker/migrations/0002_directory_catalog_payments.sql"
];
for (const path of required) assert.ok(fs.existsSync(path), "Missing required platform file: " + path);

const mapHtml = fs.readFileSync("map/index.html", "utf8");
const mapApp = fs.readFileSync("map/app.js", "utf8");
const mapCss = fs.readFileSync("map/styles.css", "utf8");
const marketHtml = fs.readFileSync("market/index.html", "utf8");
const marketApp = fs.readFileSync("market/app.js", "utf8");
const worker = fs.readFileSync("worker/src/index.js", "utf8");
const directory = fs.readFileSync("worker/src/directory-catalog.js", "utf8");
const payments = fs.readFileSync("worker/src/payments/adapter.js", "utf8");
const migration = fs.readFileSync("worker/migrations/0002_directory_catalog_payments.sql", "utf8");

assert.match(mapHtml, /id="map"/);
assert.match(mapHtml, /app\.js/);
assert.match(mapApp, /\/api\/v1\/map\/places/);
assert.match(mapApp, /openstreetmap\.org/);
assert.match(mapCss, /#map/);
assert.match(marketHtml, /\.\.\/map\//);
assert.match(marketApp, /catalog-suggestions/);
assert.match(marketApp, /ليست مخزونًا أو توفرًا مؤكدًا/);
assert.match(worker, /handleDirectoryCatalog/);
assert.match(directory, /verification_status='VERIFIED_MATCH'/);
assert.match(payments, /PAYMENT_PROVIDER_CODE/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS directory_places/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS catalog_products/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS payment_intents/);

console.log("Ibb platform validation passed: map, marketplace catalog suggestions, Worker routes, and payment-readiness schema.");

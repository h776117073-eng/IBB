import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync("market/index.html", "utf8");
const css = readFileSync("market/styles.css", "utf8");
const app = readFileSync("market/app.js", "utf8");
const merchantHtml = readFileSync("market/merchant/index.html", "utf8");
const merchantCss = readFileSync("market/merchant/styles.css", "utf8");
const merchantApp = readFileSync("market/merchant/app.js", "utf8");

function checkDomContract(markup, source, label) {
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, label + ": duplicate DOM id");
  const refs = [...source.matchAll(/\$\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  const missing = [...new Set(refs.filter((id) => !uniqueIds.has(id)))];
  assert.deepEqual(missing, [], label + ": missing DOM id");
  return { ids: ids.length, refs: refs.length };
}

assert.match(html, /<html[^>]*lang="ar"[^>]*dir="rtl"/, "Consumer page must be Arabic RTL");
assert.match(html, /href="\.\/styles\.css"/, "Consumer CSS link missing");
assert.match(html, /src="\.\/app\.js"/, "Consumer JS link missing");
assert.match(html, /href="\.\/merchant\/index\.html"/, "Merchant portal entry link missing");
assert.match(html, /id="locationDialog"/, "Neighbourhood selector dialog missing");
assert.match(html, /id="locationForm"/, "Neighbourhood selector form missing");
assert.match(html, /id="neighborhoodInput"/, "Neighbourhood input missing");
assert.match(app, /ibb-market-api\.aicreativestudio\.workers\.dev/, "Consumer API host incorrect");
assert.match(app, /ibb-market-neighborhood-v1/, "Neighbourhood preference persistence key missing");
assert.match(app, /neighborhood=/, "Consumer API requests must carry the optional neighbourhood filter");
assert.match(app, /function updateLocationLabel/, "Neighbourhood label updater missing");
assert.doesNotMatch(app, /getCurrentPosition/, "Consumer neighbourhood selector must not request GPS");
assert.doesNotMatch(app, /تحديد الحي وإذن الموقع سيضافان/, "Inactive location placeholder must be removed");
assert.doesNotMatch(app, /ibb-market-edge\.aicreativestudio\.workers\.dev/, "Image Worker must not be used as catalog API");
assert.match(css, /@media\(max-width:650px\)/, "Consumer mobile layout missing");
assert.match(css, /prefers-reduced-motion/, "Consumer reduced-motion rule missing");
assert.match(html, /لا تنفّذ طلبات شراء أو مدفوعات/, "Consumer demo limitation missing");
assert.match(html, /سلة محلية للمعاينة فقط/, "Cart demo limitation missing");


assert.match(html, /id="detailDialog"/, "Product/store detail dialog missing");
assert.match(app, /function openProduct/, "Product detail action missing");
assert.match(app, /function openStore/, "Storefront action missing");
assert.match(app, /\/api\/v1\/stores\/.*\/products/, "Store catalogue endpoint missing");
assert.match(app, /data-details/, "Product detail trigger missing");
assert.match(app, /data-store/, "Store detail trigger missing");
assert.match(app, /addEventListener\("keydown"/, "Store card keyboard interaction missing");

const consumer = checkDomContract(html, app, "consumer");

assert.match(merchantHtml, /<html[^>]*lang="ar"[^>]*dir="rtl"/, "Merchant page must be Arabic RTL");
assert.match(merchantHtml, /href="\.\/styles\.css"/, "Merchant CSS link missing");
assert.match(merchantHtml, /src="\.\/app\.js"/, "Merchant JS link missing");
assert.match(merchantHtml, /id="storeForm"/, "Store form missing");
assert.match(merchantHtml, /id="productForm"/, "Product form missing");
assert.match(merchantHtml, /name="latitude"/, "Latitude input missing");
assert.match(merchantHtml, /name="longitude"/, "Longitude input missing");
assert.match(merchantHtml, /ليست حساب تاجر متكاملًا بعد/, "Merchant limitations must be explicit");
assert.match(merchantApp, /ibb-market-api\.aicreativestudio\.workers\.dev/, "Merchant API host incorrect");
assert.match(merchantApp, /\/api\/v1\/submissions\/stores/, "Store submission endpoint missing");
assert.match(merchantApp, /\/api\/v1\/submissions\/products/, "Product submission endpoint missing");
assert.match(merchantApp, /Idempotency-Key/, "Idempotency key missing");
assert.match(merchantApp, /getCurrentPosition/, "Geolocation must be user-triggered");
assert.match(merchantApp, /escapeHtml/, "Submission response must be escaped");
assert.match(merchantCss, /@media\(max-width:520px\)/, "Merchant mobile layout missing");
const merchant = checkDomContract(merchantHtml, merchantApp, "merchant");

console.log("Market UI validation passed:", JSON.stringify({ consumer, merchant }));

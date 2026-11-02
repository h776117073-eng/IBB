import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync("market/index.html", "utf8");
const css = readFileSync("market/styles.css", "utf8");
const app = readFileSync("market/app.js", "utf8");
const merchantHtml = readFileSync("market/merchant/index.html", "utf8");
const merchantCss = readFileSync("market/merchant/styles.css", "utf8");
const merchantApp = readFileSync("market/merchant/app.js", "utf8");

assert.match(html, /<html[^>]*lang="ar"[^>]*dir="rtl"/, "واجهة السوق يجب أن تكون عربية RTL");
assert.match(html, /href="\.\/styles\.css"/, "ملف CSS غير مربوط");
assert.match(html, /src="\.\/app\.js"/, "ملف JavaScript غير مربوط");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const uniqueIds = new Set(ids);
assert.equal(uniqueIds.size, ids.length, "يوجد id مكرر في HTML");

const refs = [...app.matchAll(/\$\(["']([^"']+)["']\)/g)].map((m) => m[1]);
const missing = [...new Set(refs.filter((id) => !uniqueIds.has(id)))];
assert.deepEqual(missing, [], "JavaScript يشير إلى عناصر غير موجودة في HTML");

assert.match(app, /ibb-market-api\.aicreativestudio\.workers\.dev/, "عنوان API غير صحيح");
assert.doesNotMatch(app, /ibb-market-edge\.aicreativestudio\.workers\.dev/, "عنوان Worker الخاص بالصور لا يصلح لمسارات الكتالوج");
assert.match(css, /@media\(max-width:650px\)/, "تنسيق الهاتف غير موجود");
assert.match(css, /prefers-reduced-motion/, "إعداد تقليل الحركة غير موجود");
assert.match(html, /لا تنفّذ طلبات شراء أو مدفوعات/, "يجب توضيح أن النسخة تجريبية");
assert.match(html, /سلة محلية للمعاينة فقط/, "يجب بيان حدود السلة التجريبية");

console.log(`Market UI validation passed: ${ids.length} unique IDs, ${refs.length} DOM references, RTL and mobile rules verified.`);

const merchantIds = [...merchantHtml.matchAll(/\\bid="([^"]+)"/g)].map((m) => m[1]);
const merchantUniqueIds = new Set(merchantIds);
assert.equal(merchantUniqueIds.size, merchantIds.length, "يوجد id مكرر في بوابة التاجر");
const merchantRefs = [...merchantApp.matchAll(/\\$\\(["']([^"']+)["']\\)/g)].map((m) => m[1]);
const missingMerchantIds = [...new Set(merchantRefs.filter((id) => !merchantUniqueIds.has(id)))];
assert.deepEqual(missingMerchantIds, [], "بوابة التاجر تشير إلى عناصر HTML غير موجودة");
assert.match(merchantHtml, /id="storeForm"/, "نموذج المتجر غير موجود");
assert.match(merchantHtml, /id="productForm"/, "نموذج المنتج غير موجود");
assert.match(merchantHtml, /إرسال المساهمة للمراجعة|إرسال المتجر للمراجعة/, "يجب توضيح إرسال البيانات للمراجعة");
assert.match(merchantHtml, /ليست حساب تاجر متكاملًا بعد/, "يجب بيان حدود بوابة التاجر");
assert.match(merchantApp, /ibb-market-api\\.aicreativestudio\\.workers\\.dev/, "بوابة التاجر لا تتصل بواجهة API الصحيحة");
assert.match(merchantApp, /\\/api\\/v1\\/submissions\\/stores/, "مسار إرسال المتجر مفقود");
assert.match(merchantApp, /\\/api\\/v1\\/submissions\\/products/, "مسار إرسال المنتج مفقود");
assert.match(merchantApp, /Idempotency-Key/, "مفتاح منع التكرار مفقود");
assert.match(merchantApp, /getCurrentPosition/, "طلب الموقع يجب أن يكون بعد ضغط المستخدم فقط");
assert.match(merchantCss, /@media\\(max-width:520px\\)/, "تنسيق الهاتف لبوابة التاجر غير موجود");
console.log(`Merchant portal validation passed: ${merchantIds.length} unique IDs, ${merchantRefs.length} DOM references.`);

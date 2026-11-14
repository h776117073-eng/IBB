# تقرير التدقيق الهندسي للحالة الراهنة (MAP_CURRENT_STATE_AUDIT)
**المشروع:** محرك خرائط إب ماركت الجغرافي المتكامل (`IBB Market Geo-Engine`)
**منهجية التدقيق:** [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD) (`bmad-deep-recon` & `bmad-agent-architect`) + المواصفة المرجعية [PDR - الموسوعة الهندسية والوظيفية الشاملة (431 صفحة)](https://drive.google.com/file/d/188JNa3BqPm5wy4D71GXPKJnNp_o-xG3j/view?usp=drivesdk) و[وثيقة التصميم الهندسي الشاملة (.docx)](https://drive.google.com/file/d/17F30tjIW6GHDd92exubBu9V-iJPyoyVv/view?usp=drivesdk) و[تقرير الهندسة العكسية لخرائط جوجل عبر REA](https://docs.google.com/document/d/1w3ZsmtW8q-eFevMRuzV9hZwTgarrmwTXkmFzOuBPhvg/edit?usp=drivesdk).
**تاريخ التدقيق:** 2026-11-14

## 1. جرد المستودعات والفروع الحالية (GitHub Repositories & Branches)

جرى فحص جميع المستودعات المرتبطة بحساب المالك [`mhommdkuyr`](https://github.com/mhommdkuyr) وحساب [`mm1883814-dot`](https://github.com/mm1883814-dot) قبل إجراء أي تعديل:

| المستودع | الفروع الموجودة | آخر التزام (HEAD SHA) | الحجم واللغات | الدور الفعلي في منظومة إب ماركت |
| :--- | :--- | :--- | :--- | :--- |
| [mhommdkuyr/my-ibb-governorate-map](https://github.com/mhommdkuyr/my-ibb-governorate-map) | `main` فقط | [`18d37a9`](https://github.com/mhommdkuyr/my-ibb-governorate-map/commit/18d37a9665e8ef0bc716c4c81162d25d6c8d0e59) (`v4.0`) | `142.4 MB` (JS/HTML/CSS) | تطبيق الخريطة الحي المنشور على [GitHub Pages](https://mhommdkuyr.github.io/my-ibb-governorate-map/) ويضم أرشيفات `PMTiles` الثمانية وشظايا المحافظة الـ 29. |
| [mhommdkuyr/ibb-map-gis-downloader](https://github.com/mhommdkuyr/ibb-map-gis-downloader) | `main`, `feature/ibb-interactive-map-viewer-2026-11-11` | [`6af1723`](https://github.com/mhommdkuyr/ibb-map-gis-downloader/commit/6af1723acbf47e17bcf68e28e613ef7cd2db21b8) | `32 KB` + Releases | مستودع بناء وتوليد حزم `PMTiles` من بيانات Overture Maps وOpenStreetMap. |
| [mhommdkuyr/ibb-geospatial-scraper](https://github.com/mhommdkuyr/ibb-geospatial-scraper) | `main` | `pushed 2026-11-13` | `26.6 MB` (Python/SQLite) | خط أنابيب استخراج وتوحيد المنشآت (`ibb_master_places.csv` بحجم `7.05 MB`، و`ibb_master_places.db` بحجم `9.80 MB`، و`ibb_master_places.geojson` بحجم `16.57 MB`). |
| [mhommdkuyr/FlutterUIForAIStoreAssistant](https://github.com/mhommdkuyr/FlutterUIForAIStoreAssistant) | `main` | `pushed 2026-10-15` | `48.9 MB` (Dart/Flutter) | واجهة متجر ومساعد تسوق ذكي بتقنية Flutter متوافقة مع مواصفة `ADR-001` في الموسوعة الهندسية. |
| [mm1883814-dot/v0-delivery-app-build](https://github.com/mm1883814-dot/v0-delivery-app-build) | `main` | `pushed 2026-04-08` | TypeScript / Next.js | نموذج أولي لتطبيق التوصيل ([معاينة Vercel](https://v0-delivery-app-build-two.vercel.app)). |

## 2. جرد ملفات وبلاطات الخريطة في المستودع الأساسي (`my-ibb-governorate-map`)

### أ. أرشيفات البلاطات المتجهة (`pmtiles/` — إجمالي `153.45 MB`)
جميع ملفات `PMTiles` مبنية على إحداثيات `WGS84 (EPSG:4326)` الحقيقية من Overture Maps وOpenStreetMap:

| ملف البلاطات المتجهة | الحجم بالبايت | الحجم التقريبي | المحتوى الجغرافي الفعلي |
| :--- | :--- | :--- | :--- |
| [`pmtiles/buildings_z14_17.pmtiles`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/pmtiles/buildings_z14_17.pmtiles) | `88,518,603` | `84.4 MB` | مضلعات المباني الفعلية لمحافظة إب لمستويات التقريب `Z14` إلى `Z17` (`444,968` مبنى). |
| [`pmtiles/buildings_z18.pmtiles`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/pmtiles/buildings_z18.pmtiles) | `35,844,230` | `34.2 MB` | مضلعات وبثق المباني عالي الدقة لمستوى `Z18+`. |
| [`pmtiles/roads.pmtiles`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/pmtiles/roads.pmtiles) | `22,919,587` | `21.8 MB` | شبكة الطرق والشوارع والممرات والسلالم (`13,125` مقطع طريق). |
| [`pmtiles/settlements.pmtiles`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/pmtiles/settlements.pmtiles) | `3,741,522` | `3.57 MB` | القرى والعزل والمحلات السكنية (`12,788` تجمعاً سكنياً). |
| [`pmtiles/base.pmtiles`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/pmtiles/base.pmtiles) | `1,436,484` | `1.37 MB` | الغطاء الأرضي والمسطحات المائية والمنتزهات. |
| [`pmtiles/districts.pmtiles`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/pmtiles/districts.pmtiles) | `486,766` | `475 KB` | الحدود الإدارية لـ `20` مديرية في محافظة إب. |
| [`pmtiles/places.pmtiles`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/pmtiles/places.pmtiles) | `400,116` | `391 KB` | نقاط اهتمام Overture Maps (`475` معلماً موثقاً). |
| [`pmtiles/governorate.pmtiles`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/pmtiles/governorate.pmtiles) | `109,140` | `106 KB` | الحدود الخارجية لمحافظة إب. |

### ب. ملفات البيانات الجغرافية المقسمة (`data/`)
* **شظايا المنشآت الجغرافية (`data/shards/*.json`):** `29` ملفاً بإجمالي `4,530,463` بايت (`44,273` منشأة مصنفة على مستوى مديريات المحافظة: `D01_Ibb.json`، و`D02_Al_Dhihar.json`، و`D03_Al_Mashannah.json`، و`D04_Jiblah.json`، حتى `D20`).
* **شرائح مدينة إب السريعة (`data/ibb_pois_1..10.json`):** `10` ملفات بإجمالي `10,814` منشأة ومعلم داخل أحياء وشوارع مدينة إب مع رمز `Plus Code` ورقم الهاتف وعدد الطوابق والارتفاع.
* **الرسم البياني للتوجيه المحلي (`data/ibb_routing_graph.json` — `372 KB`):** يضم `1,422` عقدة تقاطع و`9,096` مقطع طريق موجه مع سرعات الشوارع وعقوبة الانحدار الجبلي.
* **البيانات المدمجة للإقلاع اللحظي:** `data/ibb_core_buildings_3d.json` (`977 KB` — `1,200` مضلع مبنى 3D وسط إب) و`data/ibb_core_roads.json` (`815 KB` — `2,200` مقطع طريق).

### ج. ملفات الكود والواجهة الحالية (`v4.0`)
* [`index.html`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/index.html) (`25 KB`) و[`css/style.css`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/css/style.css) (`15 KB`): واجهة عربية RTL متجاوبة للهاتف والحاسوب مع خط `Cairo`.
* [`js/app.js`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/js/app.js) (`112 KB`): محرك العرض [MapLibre GL JS v4.7.1](https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js) + [PMTiles v3.2.0](https://unpkg.com/pmtiles@3.2.0/dist/pmtiles.js) مع تخزين النطاقات الجزئية `HTTP 206` في `IndexedDB` (`ibb_pmtiles_range_cache_v3`) ومحرك بديل `2D Canvas Fallback` للأجهزة الضعيفة.
* [`js/ibb-search-worker.js`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/js/ibb-search-worker.js) (`5.8 KB`): عامل بحث خلفي بفهرسة مكانية `spatialCellKey` وتطبيع عربي ورموز `Plus Codes` و`reverseGeocode`.
* [`js/ibb-routing-worker.js`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/js/ibb-routing-worker.js) (`7.8 KB`): عامل توجيه `A*` بزوايا الانعطاف العربية وحساب المسار البديل.
* [`sdk/ibb-map-sdk.js`](https://github.com/mhommdkuyr/my-ibb-governorate-map/blob/main/sdk/ibb-map-sdk.js) (`3.1 KB`): واجهة `window.IbbMapSDK` للربط مع التطبيقات الخارجية.

## 3. جرد قاعدة البيانات السحابية الحالية (Supabase PostgreSQL)

جرى فحص مشروع Supabase النشط (`ibb-geoplatform-db` — المعرف `gdgtwonxbujgxfiqivvp`، PostgreSQL 17 في منطقة `eu-central-1`):

* **الجداول الموجودة حالياً (`2` فقط في المخطط `public`):**
  1. `public.ibb_pois`: يضم `10,814` سجلاً مستورداً من شرائح مدينة إب، مع فهارس `idx_ibb_pois_coords` و`idx_ibb_pois_cat` و`idx_ibb_pois_name_trgm`.
  2. `public.ibb_contributions`: جدول أولي للمساهمات الميدانية (`status = 'pending_review'`).
* **الدوال المكانية الموجودة (`2` فقط):** `get_ibb_pois_in_bbox` و`search_ibb_pois`.
* **امتداد PostGIS:** متاح للتفعيل في قاعدة البيانات ولكنه غير مفعّل بعد على الجداول الـ 26 المطلوبة في المواصفة.

## 4. خلاصة التدقيق مقابل متطلبات الموسوعة الهندسية (PDR)

1. **البنية الجغرافية الأساسية:** متوفرة وحقيقية 100% (بلاطات متجهة `PMTiles`، طرق ومبانٍ فعلية، قمر صناعي، تضاريس، و`10,814` منشأة في Supabase + `44,273` في الشظايا).
2. **النواقص الجوهرية التي يجب بناؤها في المراحل التالية:**
   * المخطط المكاني الكامل في PostGIS والمكون من **26 جدولاً مستقلاً** مع دورة حياة التحقق الصارمة (`RAW`, `PENDING_REVIEW`, `VERIFIED`, `REJECTED`, `PUBLISHED`, `ARCHIVED`) وتقرير الاستيراد المفصل.
   * **التكامل التجاري الثنائي الاتجاه مع إب ماركت (`/store/{merchant_id}`):** جداول `merchants` و`merchant_locations` ومنتجات المتجر وساعات العمل ومناطق التوصيل المضلعة (`delivery_zone_polygon`)، وعرض صفحة المتجر الكاملة داخل المنصة والعودة منها إلى موقع المتجر على الخريطة مع حفظ حالة الخريطة.
   * **نظام ملاحة السيارات والمشاة المتقدم:** مرشح `Kalman Filter` و`Map Matching` لإسقاط GPS على أقرب طريق، وضع القيادة ملء الشاشة (`Driving Mode HUD`)، وفصل مسارات المشاة (الأزقة والسلالم والممرات الجبلية: الطريق الأقصر مقابل الطريق الأسهل الأقل انحداراً).
   * **نظام المساهمات المجتمعية ولوحة إدارة جودة البيانات والبلاغات:** رسم الطرق والمباني الجديدة، رفع الصور والمراجعات، نظام النقاط والشارات، نظام البلاغات الـ 9، ولوحة مراجعة المشرفين (`Approve` / `Reject` مع مقارنة القديم بالجديد وسجل التدقيق).
   * **واجهات البرمجة القياسية (`/api/map/*`):** بناء الـ 20 نقطة نهاية موحدة وموثقة ومربوطة بـ Supabase PostGIS.

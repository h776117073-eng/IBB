# خريطة واجهات IBB إلى PostgreSQL/Supabase

**الحالة:** مواصفة تحويل غير تنفيذية. لا تحتوي migration أو اتصالًا تشغيليًا.  
**المصدر:** `worker/src/index.js`, `worker/src/directory-catalog.js`, `worker/src/payments/adapter.js`, `worker/migrations/0001_shared_directory.sql`, `worker/migrations/0002_directory_catalog_payments.sql`.  
**قاعدة الإنتاج الحالية:** D1 `ibb-market-shared` تظل مصدر الحقيقة حتى اكتمال shadow reads والاختبار.

## 1. النطاقات التي يجب فصلها

| النطاق | جداول D1 | المعنى |
|---|---|---|
| دليل المتاجر القابلة للإدارة | stores | متجر/نشاط تجاري منشور بعد مراجعة مساهمة |
| عروض المتاجر | products | منتج وسعر وصورة ضمن متجر محدد؛ ليس كتالوجًا عالميًا |
| المساهمات والمراجعة | submissions, moderation_audit | طلبات إدخال/اعتماد وسجل تدقيق |
| تحديد المعدل | rate_limits | حماية endpoint المساهمات |
| الدليل الجغرافي العام | directory_places | نشاط أو معلم أو شارع أو حي أو خدمة عامة مع المصدر والتحقق والموقع |
| الكتالوج المرجعي | catalog_products | تعريف منتجات عالمي/مرجعي؛ لا يعني توفرًا محليًا |
| الاقتراحات | store_catalog_suggestions, directory_catalog_suggestions | اقتراح مطابقة عنصر مرجعي مع متجر أو مكان |
| جاهزية الدفع | payment_provider_configs, payment_intents, payment_events | بنية تحضير مستقبلية؛ ليست إثباتًا أن الدفع مفعّل |

المقترح في PostgreSQL هو وضع هذه الكيانات في مخطط مستقل `ibb`، مع عدم تعديل مخطط `public` التجاري الموجود في Supabase. لا تربط تلقائيًا `ibb.stores` مع `public.merchants`، ولا `ibb.products` مع `public.products`.

## 2. عقود HTTP الحالية ومصدر البيانات

| الطريقة والمسار | مصدر D1 الحالي | شرط الوصول/الضوابط | عقد الاستجابة أو الملاحظة |
|---|---|---|---|
| GET `/api/health` | اختبار اتصال DB فقط | عام | `ok/service/database/api_version` |
| GET `/api/v1/stores` | stores | عام، APPROVED فقط | pagination، بحث نصي، فلتر neighborhood اختياري |
| GET `/api/v1/stores/:id` | stores | عام، APPROVED فقط | `{ok,store}` أو 404 |
| GET `/api/v1/stores/:id/products` | stores + products | عام، متجر APPROVED ومنتجات ACTIVE | `{ok,store,products}` |
| GET `/api/v1/products` | products + stores | عام، ACTIVE وAPPROVED | بحث/حي/متجر + pagination؛ يخرج store_neighborhood |
| POST `/api/v1/submissions/stores` | submissions + rate_limits | عام مع Idempotency-Key UUID، تحقق مدخلات، 10/day per hashed IP | pending فقط؛ لا نشر تلقائي |
| POST `/api/v1/submissions/products` | submissions + rate_limits | نفس الضوابط؛ متجر معتمد، والحي يحسم الفروع الملتبسة | السعر YER، الصورة HTTPS فقط |
| GET `/api/v1/admin/submissions` | submissions | ADMIN_API_KEY | قائمة للمراجعة حسب status/kind |
| POST `/api/v1/admin/submissions/:id/review` | submissions + stores/products + moderation_audit | ADMIN_API_KEY | APPROVE/REJECT؛ منع إعادة المراجعة |
| GET `/api/v1/admin/directory/candidates` | directory_places | ADMIN_API_KEY | مرشحو مصدر الأرشيف غير المتحققين فقط، مع تقسيم inside/outside/missing |
| GET `/api/v1/map/places` | directory_places | عام، `PUBLISHED` و`VERIFIED_MATCH` فقط | bbox محدود، kind/category/q، clustering حسب zoom |
| GET `/api/v1/map/places/:id` | directory_places | عام، منشور ومتحقق فقط | تفاصيل مكان واحد؛ geometry/coordinates/provenance |
| GET `/api/v1/catalog/products` | catalog_products | عام، quality_status=PUBLISHED | pagination وبحث/فئة؛ النتيجة `catalog_only=true`, `merchant_confirmed=false`, availability label يوضح أن التوفر غير مثبت |
| GET `/api/v1/stores/:id/catalog-suggestions` | stores + store_catalog_suggestions + catalog_products | عام لمتجر APPROVED، suggestions بحالة SUGGESTED/MERCHANT_CONFIRMED | الاقتراح المرجعي ليس مخزونًا مؤكّدًا |
| GET `/api/v1/map/places/:id/catalog-suggestions` | directory_places + directory_catalog_suggestions + catalog_products | عام لمكان BUSINESS منشور ومتحقق | ربط مرجعي لمطابقات المنتجات |
| GET `/api/v1/media/products/:key.webp` | Cloudflare R2 binding PRODUCTS | تحقق image key؛ لا يصل إلى قاعدة SQL | صورة WebP؛ تبقى في R2 لا تُنسخ تلقائيًا إلى Supabase Storage |
| GET `/api/v1/admin/catalog/stats` | directory_places + catalog_products + directory_catalog_suggestions | IMPORT_API_KEY أو ADMIN_API_KEY | عدادات الدليل والكتالوج والصور والاقتراحات |
| POST `/api/v1/admin/directory/import` | directory_places | IMPORT_API_KEY أو ADMIN_API_KEY | إدخال/تحديث upsert؛ تحقق statuses والإحداثيات |
| POST `/api/v1/admin/directory/archive-import` | directory_places | IMPORT_API_KEY أو ADMIN_API_KEY | INSERT-ONLY، تحقق صارم للهوية/Place ID/صف المصدر؛ مصدر الأرشيف غير متحقق وNEEDS_REVIEW |
| POST `/api/v1/admin/catalog/import` | catalog_products | IMPORT_API_KEY أو ADMIN_API_KEY | barcode 8–14 رقمًا، حالات جودة/ترجمة محددة، availability=REFERENCE_ONLY إجباريًا عند الاستيراد |
| POST `/api/v1/admin/directory-catalog-suggestions/import` | directory_catalog_suggestions | IMPORT_API_KEY أو ADMIN_API_KEY | score 0..1 وstatus محدد |
| GET `/api/v1/payments/readiness` | إعدادات بيئية فقط | عام | readiness فقط؛ `checkout_enabled=false` دائمًا في adapter الحالي |

### مسارات لا ينبغي اختراعها

لا يظهر في Worker الحالي endpoint لإنشاء payment intent أو استقبال webhook أو refund؛ وجود جداول الدفع في D1 وواجهة readiness لا يثبت أن الدفع مكتمل. لا تُنشئ checkout أو webhook كواجهة شكلية. يجب بناء adapter محلي واختباره قبل فتح أي مسار دفع.

## 3. مخطط Supabase الهدف المقترح

هذه حدود مجال مقترحة فقط؛ التسمية النهائية وDDL تخضع للمراجعة:

| الجدول المقترح | المصدر | أهم خصائص التحويل |
|---|---|---|
| `ibb.stores` | D1 stores | UUID/legacy_id، تطبيع الاسم والحي، status، نقطة مكانية عند الحاجة |
| `ibb.products` | D1 products | FK إلى ibb.stores، NUMERIC للسعر، YER، status، source_submission_id |
| `ibb.submissions` | D1 submissions | JSONB + schema_version، idempotency، status، submitter_hash |
| `ibb.moderation_audit` | D1 moderation_audit | append-only، reviewer identity موثوقة |
| `ibb.rate_limits` | D1 rate_limits | hash فقط، مخطط غير مكشوف، إدارة خادمية |
| `ibb.directory_places` | D1 directory_places | source_file/record/hash، kind، identity/verification/visibility، geometry GeoJSON + PostGIS geometry |
| `ibb.catalog_products` | D1 catalog_products | barcode، أسماء/ترجمات، الجودة، image key، availability reference-only |
| `ibb.store_catalog_suggestions` | D1 store_catalog_suggestions | FK إلى ibb.stores وibb.catalog_products، match_score وreview status |
| `ibb.directory_catalog_suggestions` | D1 directory_catalog_suggestions | FK إلى ibb.directory_places وibb.catalog_products |
| `ibb.payment_provider_configs` | D1 payment_provider_configs | أسرار المزود تبقى في Secrets وليس JSONB/جدول مكشوف |
| `ibb.payment_intents` | D1 payment_intents | YER، idempotency، status، provider refs؛ لا ينفذ حتى اعتماد مزود محلي |
| `ibb.payment_events` | D1 payment_events | provider event id unique، payload hash، signature_valid، سجل append-only |

ينبغي تخزين حقل geometry في PostgreSQL كـ `geometry(Geometry,4326)` أو subtype أدق بعد فحص الأشكال الموجودة. لا تفرض `Point` على السجلات التي قد تكون LineString/Polygon. احتفظ بقيم latitude/longitude والعقد JSON الحالي متوافقًا مع الواجهة، مع فهرس GiST بعد اختبار استعلامات الخريطة.

## 4. فصل بيانات المرجع عن النشاط المحلي

- `directory_places`: دليل مكان/منشأة ذات مصدر وحالة تحقق؛ لا يتحول تلقائيًا إلى متجر قابل للبيع.
- `stores`: حساب متجر فعلي يديره طرف موثوق بعد مراجعة.
- `catalog_products`: تعريف عالمي/مرجعي للمنتج؛ لا يعني توفره في اليمن.
- `products`: منتج محلي معروض من متجر محدد؛ لا يستنتج سعره أو مخزونه من الكتالوج العالمي.
- `*_catalog_suggestions`: اقتراح matching فقط؛ لا يحول الاقتراح إلى مخزون/تأكيد تاجر.

## 5. متطلبات التوافق واختبار التحويل

1. لكل endpoint اختبار snapshot لعقد JSON بما في ذلك مفاتيح status والـ pagination وحالات HTTP.
2. قارن بحث الأسماء/الأحياء بعد NFKC + lowercase + whitespace normalization؛ لا تغير دلالات filter أو ترتيب النتائج فجأة.
3. خذ حدود bbox/zoom clustering بالحسبان؛ اختبر zoom 10/12/14/16 وحدود إب الحالية.
4. لا تعرض في الخرائط العامة إلا `PUBLISHED` + `VERIFIED_MATCH`، ولا ترجع أي مرشح `NEEDS_REVIEW`.
5. لا تعرض `catalog_products` كتوفر محلي، ولا تسند `merchant_confirmed` إلا إذا كان سجل suggestion مؤكدًا فعليًا.
6. اختبر idempotency: نفس key ونفس payload يعيدان نفس النتيجة؛ key نفسها بحمولة مختلفة تعيد 409.
7. اختبر rate limit وadmin-key على مسارات المراجعة والاستيراد، ولا تجعل secret يمر من المتصفح.
8. اختبر مصدر الصور في R2 والروابط الثابتة؛ لا تستبدل image_url برابط Supabase Storage دون migration للصور.
9. اختبر archive importer منفصلًا بحالة INSERT-ONLY وتضارب source row/Place ID؛ لا تشغّل استيراد الأرشيف المؤجل في هذه المرحلة.
10. اختبر payment readiness على أنه disabled؛ لا تنفذ intent/webhook حتى يكتمل مزود محلي وHMAC/idempotency/refund/reconciliation.

## 6. حواجز الأمان والترحيل

- لا تكشف `ibb` من Data API قبل قرار مقصود بشأن exposure. الأفضل إبقاؤه غير مكشوف واستخدام endpoint خادمي مع credential محفوظ في Cloudflare Secrets أو خدمة خادمية مناسبة.
- إذا احتاج Worker اتصالًا مباشرًا إلى PostgreSQL، يجب اختيار driver/طريقة اتصال موثقة ومتوافقة مع Cloudflare Workers، واختبار pooling وTLS والمهلات. لا تفترض أن PostgreSQL TCP سيعمل لمجرد توفر عنوان DB.
- لا تسمح للمتصفح باستخدام service-role أو database password.
- RLS/grants لكل جدول يجب اختباره بصفة anon وauthenticated وservice role، مع رفض صريح للـ audit/rate_limits/submissions.
- D1 API schema files `0001` و`0002` هما مصدر التنفيذ الحالي؛ لا تخمن الجداول من وصف API فقط.
- لا تهاجر بيانات الأرشيف 7,015 أو الملف 16,441 الخام، ولا تفعل الأرشيف دون استئناف صريح من صاحب المشروع.
- يجب أخذ snapshot/checksum قبل أي ترحيل، والقدرة على العودة إلى D1 دون فقد طلبات أو مساهمات.

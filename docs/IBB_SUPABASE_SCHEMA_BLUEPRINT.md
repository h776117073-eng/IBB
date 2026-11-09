# مواصفات مخطط PostgreSQL المقترح لـ IBB

**النوع:** تصميم أولي غير تنفيذي (Architecture Blueprint).  
**الحالة:** للمراجعة قبل إنشاء migration. لا يحتوي الملف على SQL قابل للتطبيق.  
**الحد الفاصل:** مخطط مستقل باسم `ibb`؛ لا تعديل على `public.merchants` أو `public.orders` أو بقية نموذج التجارة الموجود.

## 1. لماذا مخطط مستقل؟

مخطط Supabase الحالي ليس قاعدة D1 الخاصة بتطبيق إب. قاعدة D1 الحالية تحوي دليل متاجر ومراجعات ومساهمات، في حين أن Supabase يحوي تجارًا وعملاء وسلالًا وطلبات ورسائل WhatsApp. وحتى جدول `products` مختلف بين النظامين.

لهذا يجب إنشاء نطاق مستقل لـ IBB، مع إبقاء جداول `public` الحالية دون تعديل. لا توجد علاقة آمنة يمكن افتراضها بين `merchants` و`stores` أو بين منتجات النظامين.

## 2. المصدر الحالي: D1

المصدر التنفيذي الكامل في الفرع الحالي هو `worker/migrations/0001_shared_directory.sql` و`worker/migrations/0002_directory_catalog_payments.sql` مع `worker/src/index.js` و`worker/src/directory-catalog.js` و`worker/src/payments/adapter.js`.

| كيان D1 | دوره الحالي |
|---|---|
| stores | الدليل المنشور: الاسم، التصنيف، الوصف، الحي، الإحداثيات، حالة المنشأة والتحقق |
| products | منتجات مرتبطة بمتجر مع السعر والعملة والصورة والحالة |
| submissions | صندوق المساهمات: STORE/PRODUCT، مفتاح idempotency، payload، حالة المراجعة وسببها |
| moderation_audit | سجل قرارات APPROVE/REJECT |
| rate_limits | حواجز معدل المساهمات حسب بصمة IP مجزأة |
| directory_places | دليل جغرافي عام لمتجر/معلم/شارع/حي/خدمة عامة، يتضمن المصدر والتحقق والظهور والهندسة |
| catalog_products | كتالوج منتجات مرجعي عالمي مع barcode والترجمة وجودة البيانات والصورة |
| store_catalog_suggestions | اقتراحات مطابقة منتجات الكتالوج بمتجر حقيقي |
| directory_catalog_suggestions | اقتراحات مطابقة منتجات الكتالوج بمكان في الدليل الجغرافي |
| payment_provider_configs | تعريف readiness/إعدادات مزود الدفع؛ لا يخزن أسرار المزود |
| payment_intents | نوايا دفع مع YER وidempotency وحالة |
| payment_events | أحداث مزود الدفع مع hash وتحقق التوقيع وسجل فريد للحدث |

## 3. نموذج IBB المقترح

### 3.1 `ibb.stores`

الحقول المنطقية:
- `id`: UUID بعد إثبات أن جميع IDs الحالية قابلة للتحويل من النص إلى UUID؛ وإلا تُحفظ قيمة المصدر في `legacy_id` مع UUID جديد ثابت.
- `name`, `name_norm`, `category`, `category_norm`, `description`.
- `neighborhood`, `neighborhood_norm`.
- `location`: PostGIS geography(Point, 4326) أو geometry(Point, 4326) بعد قرار الاستخدام؛ لا يُنشأ هذا الحقل قبل تثبيت PostGIS.
- `status`: APPROVED أو SUSPENDED، مع عدم نشر السجل إلا إذا كان معتمدًا.
- `owner_verified`: حالة عرض فقط، لا تُعد دليل ملكية ولا يحق للزائر ضبطها.
- `source_submission_id`, `created_at`, `updated_at`.

الفهارس المتوقعة بعد القياس:
- unique على (`name_norm`, `neighborhood_norm`) للحفاظ على كشف التكرار الحالي.
- B-tree على الحالة/تاريخ التحديث.
- GiST على location إذا ثبتت الحاجة للاستعلام المكاني.

### 3.2 `ibb.products`

- `id` UUID أو UUID مع `legacy_id` وفق نتيجة تحقق المصدر.
- `store_id` FK إلى `ibb.stores(id)`.
- `name`, `name_norm`, `category`, `category_norm`, `description`.
- `price` NUMERIC بدل REAL لتجنب تقريب أرقام السعر، و`currency` مع قيد YER إلى أن يقر PDR خلاف ذلك.
- `image_url` HTTPS فقط، `status` ACTIVE/SUSPENDED.
- `source_submission_id`, `created_at`.

الفهارس: unique على (`store_id`, `name_norm`) وفهرس على الحالة/تاريخ الإنشاء. لا تربط الحقل `store_id` بـ `merchant_id` في مخطط التجارة الحالي.

### 3.3 `ibb.submissions`

- `id` UUID؛ `kind` STORE/PRODUCT.
- `idempotency_key` UUID؛ unique على (`kind`, `idempotency_key`).
- `payload` JSONB مع نسخة schema للتحقق من شكل البيانات عند الاسترجاع.
- `status` PENDING/APPROVED/REJECTED.
- `submitter_hash` فقط؛ لا تخزن IP الخام.
- `created_at`, `reviewed_at`, `review_reason`.
- يوصى بإضافة `reviewed_by` إلى هوية إدارية موثوقة بعد تحديد نظام المصادقة، لا اعتمادًا على `user_metadata`.

### 3.4 `ibb.moderation_audit`

سجل append-only لقرار المراجعة:
- `id` UUID و`submission_id` FK.
- `decision` APPROVE/REJECT، `reason`, `actor_type`, `actor_id`, `created_at`.
- لا يمنح المستخدم العادي صلاحية UPDATE أو DELETE على هذا السجل.

### 3.5 `ibb.rate_limits`

- `bucket_key` قيمة SHA-256 وليست عنوان IP.
- `hits` عدد المحاولات و`reset_at` timestamptz.
- مخطط داخلي غير مكشوف لـ Data API؛ لا يسمح للزائر بقراءة أو تعديل عدادات غيره.
- يجب مقارنة سياسة الاحتفاظ والتنظيف مع Worker الحالي قبل التنفيذ.

## 4. قواعد البيانات الجغرافية

- PostGIS متاح على المشروع لكن غير مثبت. لا تعتمد على وجوده حتى يظهر كامتداد مثبت.
- عند اعتماده، استخدم SRID 4326 صراحة، وتحقق من ترتيب longitude/latitude عند إنشاء النقطة.
- أضف GiST index على الموقع للاستعلام داخل الأحياء/النطاقات أو الفرز بالمسافة.
- لا تخلط إحداثيات المنشآت مع أسماء الأزقة التاريخية أو المعالم غير الموثقة.
- يلزم اختبار أن النتيجة الجغرافية متطابقة مع استجابة API الحالية قبل تحويل واجهة الخريطة.

## 5. تصميم الوصول والأمن

مبدأ الوصول الأولي:

| الكيان | قراءة الزوار | كتابة الزوار | كتابة/إدارة الخادم |
|---|---|---|---|
| stores | الصفوف المنشورة/المعتمدة فقط | لا | إنشاء/تعديل/تعليق بعد مراجعة |
| products | النشطة المرتبطة بمتجر معتمد فقط | لا | إضافة/تعديل بعد مراجعة |
| submissions | لا | عبر endpoint خادمي يتحقق من البيانات وidempotency وrate limit | مراجعة الحالة |
| moderation_audit | لا | لا | append-only من خدمة المراجعة |
| rate_limits | لا | لا | خدمة الخادم فقط |

- يفضل عدم إضافة مخطط `ibb` إلى exposed schemas في Data API حتى يثبت احتياج العميل إليه.
- Worker/API server أو Edge Function هو حد الثقة: يتحقق من المدخلات، CORS، idempotency، rate limits وصلاحية المراجع.
- لا يوضع service-role أو secret key في تطبيق الويب أو ملفات Git.
- لا تنشأ سياسة قراءة عامة على جدول `products` الحالي أو غيره.
- أي سياسة `authenticated` يجب أن تثبت ملكية السجل أو عضوية دور من مصدر موثوق.
- تُراجع منح الجداول قبل إنشاء سياسات RLS. مجرد تفعيل RLS مع غياب السياسات يمنع الوصول عبر Data API، ولا يعني أن التصميم اكتمل.

## 6. بوابة الاختبارات

يجب نجاح الاختبارات التالية قبل migration أو الربط:

1. **التوافق:** تحويل كل قيمة ID وإحداثية وسعر من D1 دون فقد أو تقريب، وإخراج قائمة صفوف مرفوضة بدل تجاوزها.
2. **التكرار:** المتجر بالاسم والحي نفسه يرفض كنسخة مكررة؛ الاسم نفسه في حيين مختلفين يبقى ممكنًا.
3. **المنتج:** لا يقبل منتجًا لمتجر غير معتمد؛ ويُرفض اسم متجر ملتبس عند وجود أكثر من فرع بلا حي.
4. **idempotency:** نفس المفتاح والحمولة يعيدان نفس النتيجة؛ المفتاح نفسه بحمولة مختلفة يعيد 409.
5. **المراجعة:** لا يمكن اعتماد السجل مرتين أو تغيير قرار بعد إغلاقه دون إجراء إداري صريح.
6. **العزل:** الزائر لا يقرأ submissions أو audit أو rate_limits ولا يكتب في stores/products مباشرة.
7. **العمليات:** اختبارات رفض SELECT/INSERT/UPDATE/DELETE لكل دور، واختبارات سماح للصفوف العامة المعتمدة فقط.
8. **الجغرافيا:** SRID 4326، حدود الإحداثيات، GiST، استعلام الحي/المسافة، ومقارنة نتائج API.
9. **الاستجابة:** تطابق مفاتيح JSON والحالات HTTP الحالية لـ `/api/v1/stores`, `/api/v1/products`, submissions والمراجعة.
10. **الرجوع:** snapshot + checksums + سجل دفعات + إعادة استئناف + rollback إلى D1.

## 7. خطوات التنفيذ بعد اعتماد المواصفات

1. تحقق من مفاتيح D1 الفعلية وقيم IDs والصفوف وأشكال الحمولات.
2. حسم نظام المستخدمين وملكية المتاجر وصلاحية المراجعين.
3. حسم PostGIS والحقول المكانية.
4. إنشاء migration بواسطة Supabase CLI، وعدم اختراع اسم migration يدويًا.
5. اختبار migration وRLS على بيئة محلية أو branch معزول؛ branch جديد لا ينشأ قبل مراجعة كلفته.
6. تطبيق المخطط المستقل بعد مراجعة SQL، ثم اختبارات ما بعد التطبيق.
7. بناء adapter خادمي في Worker يحافظ على عقد API.
8. تنفيذ shadow reads وchecksum، ثم التبديل فقط بعد اجتياز بوابة rollback.

## 8. ما لا يشمله هذا التصميم

- لا يستورد أرشيف Google Maps أو ملف 16,441 الخام.
- لا يعتبر أسماء المصدر فقط منشآت معتمدة.
- لا ينشئ نظام دفع أو Escrow أو طلبات شراء.
- لا يغيّر مخطط التجارة الحالي ولا يربط جداول العملاء/التجار تلقائيًا بسجلات الدليل.
- لا يغير main أو إعدادات Cloudflare الإنتاجية.


## 3.6 `ibb.directory_places` — دليل الأماكن والمواقع

يستوعب الكيان أنواعًا مختلفة عن المتجر الذي يملكه تاجر:
- المصدر: `source_file`, `source_record_id`, `source_name`, `source_status`, `source_url`, `source_hash`, `place_id`, `plus_code`, `osm_source_id`.
- التعريف: `name`, `name_norm`, `kind`, `category`, `category_norm`, `source_category`.
- العنوان والاتصال: `address`, `address_norm`, `district`, `neighborhood`, `phone`, `email`, `website_url`.
- الوصف والتشغيل: `description`, `cover_image_url`, `opening_hours` JSONB، `rating`, `review_count`, `operational_status`.
- الموقع: `latitude`, `longitude`, `location_precision`, `location_status`, `geometry` من نوع PostGIS عام SRID 4326 بعد تثبيت الامتداد، مع حفظ الشكل المتوافق مع GeoJSON في عقد API.
- الثقة والنشر: `identity_status`, `verification_status`, `visibility_status`, `is_commercial`, `is_public`.
- الهوية الفريدة للمصدر: unique على (`source_file`, `source_record_id`)، مع فحص تعارض Place ID.

لا تُفرض هندسة Point على جميع السجلات؛ D1 يسمح POINT/LINESTRING/MULTILINESTRING/POLYGON/MULTIPOLYGON. اختبر استيراد وقراءة كل نوع قبل اختيار العمود المكاني النهائي. لا تستورد سجلات الأرشيف المؤجلة الآن.

## 3.7 `ibb.catalog_products` — كتالوج مرجعي

- مفتاح `barcode` نصي للحفاظ على الأصفار البادئة.
- أسماء مصدر وعربية وعلامة وفئة ووصف.
- `image_key`, حالة الصورة ومصدرها، حالة الترجمة والجودة.
- `availability_status` يبدأ بــ `REFERENCE_ONLY`; لا تعرض أي كتالوج كتوفر محلي أو مخزون.
- احتفظ بصلة صورة R2 الحالية؛ لا تنقل الصور إلى Supabase Storage تلقائيًا.

## 3.8 اقتراحات الكتالوج

- `ibb.store_catalog_suggestions`: FK إلى `ibb.stores` و`ibb.catalog_products`, unique (`store_id`, `barcode`), درجة مطابقة 0..1 وحالة `SUGGESTED/MERCHANT_CONFIRMED/REJECTED`.
- `ibb.directory_catalog_suggestions`: FK إلى `ibb.directory_places` و`ibb.catalog_products`, unique (`directory_place_id`, `barcode`) بنفس حالات المراجعة.
- `MERCHANT_CONFIRMED` لا يضبط إلا بعد تأكيد موثوق من صاحب المتجر/المراجع، ولا يتحول إلى stock أو sale price تلقائيًا.

## 3.9 جداول الدفع المستقبلية

D1 يحتوي `payment_provider_configs`, `payment_intents`, `payment_events`. يمكن توثيق هذه الكيانات للمرحلة اللاحقة فقط:
- لا تُخزن provider secrets في قاعدة البيانات أو Git؛ تحفظ في Secrets.
- لا تُنشئ endpoint intent/webhook/refund لمجرد وجود الجداول؛ adapter الحالي يعرض readiness ويثبت `checkout_enabled=false`.
- لا تفعل الدفع إلا بعد اختيار مزود محلي واختبارات HMAC، replay/idempotency، refund، reconciliation، وحماية المبالغ بعملة YER.
- لا تربط تلقائيًا `payment_intents` مع `public.orders`؛ اختلاف نموذج المرجع يجب حسمه أولًا.


## 9. وسيلة الربط مع Cloudflare Worker

المسار الموصى به هو Cloudflare Hyperdrive وليس كشف `ibb` للواجهة عبر Supabase Data API:
- استخدم اتصال Supabase المباشر Direct connection داخل Hyperdrive؛ Hyperdrive يقوم بإدارة pooling.
- أنشئ DB role مستقلًا باسم `ibb_worker` بصلاحيات أقل ما يمكن على مخطط `ibb` فقط، ولا تمنحه `postgres` أو صلاحيات على مخطط التجارة الحالي.
- استخدم Postgres driver `pg` مثبت الإصدار في Worker، وbinding باسم `HYPERDRIVE`، واقرأ connection string من `env.HYPERDRIVE.connectionString`.
- لا تضع connection string أو كلمة المرور في Git أو `wrangler.toml` أو الواجهة. ولا تستخدم service-role key لهذا الاتصال.
- يجب اختبار الاتصال وTLS والمهلات والـ pooling، ثم إجراء shadow reads قبل توجيه أي endpoint إلى PostgreSQL.
- وقت إنشاء هذه المواصفة، حساب Cloudflare لا يحتوي Hyperdrive configuration، وWorker config لا يحتوي binding أو PostgreSQL driver. لم يتم إنشاء DB role أو connection string أو Hyperdrive resource.

مراجع التنفيذ:
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/
- https://supabase.com/docs/guides/api/using-custom-schemas

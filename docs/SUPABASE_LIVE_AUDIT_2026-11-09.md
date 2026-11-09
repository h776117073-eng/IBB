# تدقيق قاعدة Supabase الحية — 2026-11-09

## نطاق الفحص

- المشروع: `yemen-commerce-ai`
- Project ref: `fruuvdvyyueobgpxsder`
- الحالة وقت الفحص: `ACTIVE_HEALTHY`
- المحرك: PostgreSQL `17.6.1.166`
- وسيلة الفحص: Supabase MCP read-only inventory, SQL SELECT catalog inspection, Security/Performance/Health Advisors.
- لم تُنفّذ أوامر DDL/DML، ولم تتغير بيانات أو صلاحيات أو امتدادات.

## الجداول والمحتوى

| الجدول | النتيجة |
|---|---|
| merchants | موجود، 0 صفوف |
| customers | موجود، 0 صفوف |
| products | موجود، 0 صفوف |
| carts | موجود، 0 صفوف |
| cart_items | موجود، 0 صفوف |
| orders | موجود، 0 صفوف |
| order_items | موجود، 0 صفوف |
| payment_receipts | موجود، 0 صفوف |
| whatsapp_messages | موجود، 0 صفوف |
| audit_logs | موجود، 0 صفوف |

كل الجداول العشرة في مخطط `public` عليها RLS. جرد `pg_policies` أعاد صفر سياسات. وفق دليل Supabase، RLS دون سياسات يمنع صفوف Data API من القراءة والكتابة؛ هذا fail-closed وليس إذنًا للمستخدمين.

## سجل الهجرات

| الإصدار | الاسم |
|---|---|
| 20260923193843 | initial_yemen_commerce_schema |
| 20260923194032 | harden_public_rls_and_rpc |
| 20260923194045 | restrict_order_rpc_execute |
| 20260923205928 | add_whatsapp_processing_state |

هذه الهجرات موجودة في سجل المشروع الحي. لم نعثر ضمن شجرة مستودع IBB على مجلد `supabase/migrations` مقابل لها، لذا لا ينبغي افتراض أن المستودع يمتلك مصدرًا كاملًا لإعادة إنتاج هذا المخطط.

## الامتدادات

- `vector 0.8.2` مثبت في `public`.
- `pgcrypto 1.3`, `uuid-ossp 1.1`, `pg_stat_statements 1.11`, `supabase_vault 0.3.1`, `plpgsql 1.0` مثبتة.
- PostGIS غير مثبت. النسخة المتاحة حاليًا `3.3.7`.
- لا يوجد سبب لتركيب PostGIS الآن قبل تحديد أعمدة الهندسة والفهارس ونطاق GIS المطلوب.
- Advisor يحذر من وجود امتداد `vector` داخل `public`؛ لا تنقله دون فحص الاعتماديات واختبار إعادة إنشاء الفهرس.

## سياسات وصلاحيات

- عدد سياسات RLS في `public`: **0**.
- كل من `anon` و`authenticated` لديه منح على الجداول العشرة تشمل SELECT وINSERT وUPDATE وDELETE وREFERENCES وTRIGGER وTRUNCATE.
- RLS حاليًا يمنع وصول الصفوف عبر API لغياب السياسات، لكن المنح الواسعة غير ملائمة كأساس لإضافة سياسات مستقبلية. يجب إعداد GRANT/REVOKE مصفوفة أقل صلاحية قبل فتح أي جدول.
- صلاحيات المخطط: الأدوار `anon`, `authenticated`, `service_role` لديها USAGE في public ولا تملك CREATE.
- لم تُثبت إعدادات Data API exposure من إعدادات لوحة المشروع ضمن هذا الفحص؛ لا تفترض التعريض لمجرد وجود الجدول.

## الدوال المكشوفة

| الدالة | النوع | صلاحية التنفيذ المرصودة |
|---|---|---|
| approve_order(text, uuid) | SECURITY DEFINER | postgres وservice_role فقط |
| reject_order(text, uuid, text) | SECURITY DEFINER | postgres وservice_role فقط |
| match_products(vector, uuid, integer) | SECURITY INVOKER | anon وauthenticated وservice_role |

دالتا اعتماد/رفض الطلبات تضبطان `search_path=public` وتبقيان محصورتين في دور الخدمة. لا توسع صلاحية التنفيذ عنهما. دالة `match_products` تعتمد على سياسات قراءة جدول `products`، وتأخذ merchant UUID من المدخل؛ لا تُنشئ سياسة قراءة واسعة للمنتجات قبل وجود علاقة ملكية موثوقة وربط `merchant_id` بهوية المصادق عليه.

## نتائج Advisors

### Security
1. `rls_enabled_no_policy`: 10 جداول، بلا سياسات RLS.
2. `extension_in_public`: امتداد vector مثبت في مخطط public.

### Performance
1. `unindexed_foreign_keys`: 10 قيود أجنبية بلا فهرس يغطي العمود المرجعي:
   - audit_logs.merchant_id
   - cart_items.product_id
   - carts.customer_id
   - carts.merchant_id
   - order_items.order_id
   - order_items.product_id
   - orders.customer_id
   - orders.merchant_id
   - payment_receipts.order_id
   - whatsapp_messages.customer_id
2. `unused_index`: ثلاثة فهارس لم تسجل استخدامًا حتى وقت الفحص:
   - products_merchant_active_idx
   - products_embedding_hnsw_idx
   - whatsapp_messages_processing_idx

بما أن الجداول فارغة ولم يتم تشغيل تطبيق إب فوقها، لا تحذف الفهارس غير المستخدمة الآن. أضف الفهارس الناقصة فقط بعد قياس أحمال النظام الآخر والتأكد من عدم إنشاء فهارس مكررة.

### Health
- لا توجد ملاحظات في نتيجة Health Advisor وقت الفحص.

## حالة مصدر D1 مقابل المستودع

تم العثور على ملفي D1 المصدرين في الفرع الذي يتضمن توسعات التطبيق:

- `worker/migrations/0001_shared_directory.sql` — stores/products/submissions/moderation_audit/rate_limits.
- `worker/migrations/0002_directory_catalog_payments.sql` — directory_places/catalog_products/store_catalog_suggestions/directory_catalog_suggestions/payment_provider_configs/payment_intents/payment_events.

**قيد التحقق:** محاولة قراءة `sqlite_master` من D1 عبر Cloudflare API رجعت 404 على endpoint routing، لذلك هذه مطابقة لملفات migrations في GitHub ولا تمثل فحصًا حيًا لمخطط D1. لا تفترض أن كل migration تم تطبيقها على قاعدة D1 الحية قبل فحص `d1_migrations`/`sqlite_master` من مسار إداري صالح.

## مطابقة مخطط IBB

مخطط D1 المصدر في الفرع الذي يحتوي توسعات الكتالوج يتكون من 12 جدولًا عبر ملفي migration:

- `stores`, `products`, `submissions`, `moderation_audit`, `rate_limits`.
- `directory_places`, `catalog_products`, `store_catalog_suggestions`, `directory_catalog_suggestions`.
- `payment_provider_configs`, `payment_intents`, `payment_events`.

الملف `0002_directory_catalog_payments.sql` موجود في الفرع `feature/ibb-market-neighborhood-selector-2026-11-09`. يضيف دليل الأماكن والكتالوج والاقتراحات وبنية الدفع المستقبلية. وجود DDL الدفع وendpoint readiness لا يثبت أن checkout أو webhook أو refund مفعّل.

Supabase الحالي لديه جداول لتجار وعملاء وسلال وطلبات ومدفوعات ورسائل WhatsApp. جدول `products` في Supabase يختلف بنيويًا عن جدول D1:
- Supabase: `merchant_id`, `price_yer`, `stock`, `active`, `embedding`.
- D1: `store_id`, `price`, `currency`, `status`, `source_submission_id`.

ولا توجد جداول Supabase مقابلة لـ `stores`, `submissions`, `moderation_audit`, `rate_limits`, أو كيانات `directory_places` و`catalog_products` واقتراحاتها. كما أن D1 تمتلك جداول دفع ذات غرض readiness/intent/events تختلف عن `orders/payment_receipts` في Supabase. بناء على ذلك لا يوجد تطابق مباشر ولا يمكن وصل Worker بقاعدة Supabase الحالية دون تصميم مجال منفصل.

## ملاحظة ملكية الحساب

لا يظهر ضمن أعمدة `public.merchants` حقل مستخدم مصادق عليه أو FK إلى `auth.users`. لذلك لا يمكن استنتاج هوية مالك التاجر أو سياسات ملكية من صفوف merchants الحالية وحدها. يلزم تعريف ربط هوية/عضوية صريح قبل سياسات authenticated.

## ملكية حساب التاجر

جرد أعمدة `public.merchants` لا يظهر عمود `auth_user_id` أو FK إلى `auth.users`. لا يمكن بناء سياسة ملكية تاجر على الجدول الحالي دون تعريف علاقة مستخدم/عضوية موثوقة. يجب تصميم هذا الربط قبل سياسات authenticated.

## قرار التنفيذ

**المسموح حاليًا:** إعداد مخطط IBB مستقل وعقود API والاختبارات وتوثيق migration.  
**غير المسموح بعد:** إضافة سياسات أو منح عامة إلى الجداول الحالية، تغيير جداول التجارة الحالية، تثبيت extensions أو تطبيق DDL على قاعدة الإنتاج، نقل بيانات D1، أو نشر Worker يعتمد على Supabase.

قبل أي Migration:
1. اعتماد schema مستقل باسم `ibb` (أو اسم واضح آخر) دون تعديل `public` الحالي.
2. تثبيت PostGIS فقط إذا أكد التصميم الحاجة إلى أنواع geometry/geography وفهارسها.
3. تعريف ملكية الحساب/التاجر عبر جدول عضوية موثوق مرتبط بـ `auth.users`.
4. وضع سياسات منشآت منشورة للقراءة العامة، ومساهمات للمراجعة، وصلاحيات إدارة خادمية.
5. تقليص table grants للأدوار قبل إنشاء سياسات RLS، وإضافة اختبارات رفض وإتاحة لكل عملية.
6. إنشاء migration من خلال Supabase CLI، واختبارها على بيئة محلية أو branch منفصل مع موافقة تكلفة الفرع قبل إنشائه.
7. إعداد secret خادمي في Cloudflare/Edge Function بعد تصميم مسار الاتصال؛ لا تضعه في Git أو في العميل.
8. تنفيذ shadow reads ومقارنة checksums قبل أي تحويل لمصدر البيانات.

**النتيجة:** نجح الاتصال الحي والجرد والتدقيق الأولي لقاعدة Supabase. لم يتسنَّ إجراء جرد مباشر لـ D1 عبر Cloudflare API في هذه الدفعة، لذا استندت مقارنة D1 إلى migrations المصدر في GitHub. لم يكتمل ربط التطبيق، ولم تتغير قاعدة بيانات Supabase.


## مسار الاتصال من Cloudflare

- استعلام قائمة Hyperdrive في حساب Cloudflare المرتبط أعاد صفر إعدادات.
- ملف Worker `wrangler.toml` الحالي يربط D1 ولا يملك `HYPERDRIVE` binding.
- `worker/package.json` الحالي لا يتضمن PostgreSQL driver `pg`.
- لم يتم إنشاء login role خاص بـ IBB أو connection string أو Hyperdrive config.
- Cloudflare توثق اتصال Supabase عبر Hyperdrive باستخدام Direct connection؛ Hyperdrive يتولى pooling. يفضل DB role منفصل محدود على `ibb` دون منحه عضوية `postgres` أو صلاحية على `public`.
- عدم وجود Hyperdrive config يعني أنه لا توجد قناة Worker→Supabase جاهزة حتى الآن.

المراجع الرسمية:
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/
- https://supabase.com/docs/guides/api/using-custom-schemas

## حدود التحقق من D1

الملفان المصدران `worker/migrations/0001_shared_directory.sql` و`worker/migrations/0002_directory_catalog_payments.sql` موجودان في الفرع الذي يحتوي توسعات التطبيق. لكن محاولة قراءة `sqlite_master` عبر Cloudflare D1 REST API رجعت 404 routing، وكذلك محاولة listing endpoint. لذلك لا أصف مخطط D1 بأنه verified-live؛ هو مطابق لمصدر GitHub فقط حتى يتوفر مسار إداري صالح لفحص D1 الحية.

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

## مطابقة مخطط IBB

Worker/D1 في المستودع لديه الجداول:

- `stores`
- `products`
- `submissions`
- `moderation_audit`
- `rate_limits`

Supabase الحالي لديه جداول لتجار وعملاء وسلال وطلبات ومدفوعات ورسائل WhatsApp. جدول `products` في Supabase يختلف بنيويًا عن جدول D1:
- Supabase: `merchant_id`, `price_yer`, `stock`, `active`, `embedding`.
- D1: `store_id`, `price`, `currency`, `status`, `source_submission_id`.

ولا توجد جداول Supabase مقابلة لـ `stores`, `submissions`, `moderation_audit`, `rate_limits`. بناء على ذلك لا يوجد تطابق مباشر ولا يمكن وصل Worker بقاعدة Supabase الحالية دون تصميم مجال منفصل.

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

**النتيجة:** نجح الاتصال الحي والجرد والتدقيق الأولي. لم يكتمل ربط التطبيق، ولم تتغير قاعدة البيانات.

# خطة تأسيس Supabase — سوق إب

**الحالة:** الجرد الحي اكتمل؛ لم تُنفذ أي كتابة إلى قاعدة Supabase أو نقل بيانات.  
**مرجع المنتج:** وثيقة PDR في Drive، إصدار PDR-HLM-ENCYCLOPEDIA-2026-V10.0.  
**المشروع:** `yemen-commerce-ai` — `fruuvdvyyueobgpxsder` — `ap-northeast-2`.  
**آخر تحقق:** 2026-11-09 — الحالة `ACTIVE_HEALTHY` — PostgreSQL 17.6.1.166.

## 1. قرار البنية

- الهدف طويل المدى: PostgreSQL/PostGIS قاعدة البيانات التشغيلية الأساسية، بما يتوافق مع ADR-008 في PDR.
- Cloudflare Workers تبقى طبقة API/edge والحماية والتخزين المؤقت.
- D1 الحالية تبقى مصدر تشغيل دليل إب إلى أن يُنفذ ترحيل مضبوط ومختبر؛ يمنع تشغيل الكتابة المزدوجة.
- لا ننقل أرشيف Google Maps المؤجل أو سجلات غير موثقة ضمن تأسيس القاعدة.
- مخطط Supabase الحالي يحتوي نموذج تجارة منفصلًا (merchants/orders/WhatsApp)، ولا يجوز إعادة استخدام جداول هذا النموذج للدليل بمجرد تشابه الاسم.
- المسار المقترح: إنشاء مخطط مستقل لـ IBB بعد مراجعة DDL، ثم adapter خادمي إلى Worker، مع إبقاء public schema الحالية دون تعديل.
- لا نضع service-role أو secret key في المتصفح أو GitHub. ولا يتم نشر أي سر إلا من إعدادات Secrets على مزود الخدمة.

## 2. نتيجة الجرد الحي — 2026-11-09

المشروع أصبح `ACTIVE_HEALTHY`، ونجحت أدوات القراءة من قاعدة البيانات. الجرد وجد:

- 10 جداول في `public`: `merchants`, `customers`, `products`, `carts`, `cart_items`, `orders`, `order_items`, `payment_receipts`, `whatsapp_messages`, `audit_logs`.
- جميع هذه الجداول العشرة فارغة بحسب عدد الصفوف الذي رجعته أداة الجرد.
- 4 migrations مسجلة: `20260923193843 initial_yemen_commerce_schema`, `20260923194032 harden_public_rls_and_rpc`, `20260923194045 restrict_order_rpc_execute`, `20260923205928 add_whatsapp_processing_state`.
- امتداد `vector 0.8.2` مثبت في `public`. امتداد PostGIS متاح بالإصدار `3.3.7` لكنه **غير مثبت**. لا تُنشأ أعمدة مكانية قبل تثبيت PostGIS واعتماد تصميم جغرافي متوافق مع PDR.
- لا يوجد أي سجل دليل إب أو مساهمة مراجعة ضمن الجداول الحالية. ولم نجرِ استيراد أي سجل.

## 3. عدم تطابق نموذج البيانات

مخطط Worker/D1 الحالي في المستودع يستخدم:

- `stores`: الاسم، النشاط، الحي، الإحداثيات، حالة النشر والتحقق.
- `products`: ارتباط بالمتجر، الاسم والسعر والصورة والحالة.
- `submissions`: طلبات إضافة متجر/منتج، مفتاح منع التكرار، بيانات الإرسال، حالة المراجعة.
- `moderation_audit`: سجل قرارات المراجعة.
- `rate_limits`: تحديد معدل المساهمات.

أما Supabase الحالي فيستخدم نموذجًا مختلفًا: `merchants/customers/carts/orders/payment_receipts/whatsapp_messages`. حتى جدول `products` مختلف: يعتمد `merchant_id`, `price_yer`, `stock`, `active`, `embedding` بدل `store_id`, `price`, `currency`, `status` في D1. لا توجد جداول مقابلة لـ `stores`, `submissions`, `moderation_audit`, أو `rate_limits`.

**قرار:** لا يوجد mapping مباشر واحد-إلى-واحد. أي ترحيل يحتاج مخطط `ibb` مستقلًا، وخريطة تحويل حقلية، واختبارات تطابق API؛ لا تعدّل جداول التجارة الموجودة ولا تربطها قسرًا.

## 4. نتائج الأمان والأداء

### الأمان

- RLS مفعّل على الجداول العشرة، لكن عدد سياسات RLS يساوي صفرًا. لذلك لا يمكن قراءة أو كتابة صفوفها عبر Data API بأدوار المستخدمين العاديين حاليًا؛ هذا منع افتراضي مغلق وليس سياسة وصول مكتملة.
- رغم ذلك، `anon` و`authenticated` يملكان منحًا واسعة على الجداول العشرة تشمل SELECT/INSERT/UPDATE/DELETE إضافة إلى REFERENCES/TRIGGER/TRUNCATE. قبل إنشاء أي سياسة يجب تقليص المنح إلى الحد الأدنى لكل دور. لا تضف سياسة عامة أو `TO authenticated` بلا شرط ملكية.
- `approve_order` و`reject_order` دالتان `SECURITY DEFINER`؛ التنفيذ محصور حاليًا في `postgres` و`service_role`، ولا يملك `anon` أو `authenticated` صلاحية التنفيذ. احتفظ بهذا القيد وراجع `search_path=public` قبل أي تغيير.
- `match_products` دالة `SECURITY INVOKER` لكنها قابلة للتنفيذ من `anon` و`authenticated`. لا توسع سياسات قراءة `products` حتى يُعرّف نموذج ملكية التاجر ويُختبر عزل بيانات التاجر.
- امتداد `vector` مثبت في مخطط `public` وأظهر Advisor تحذيرًا بنقله إلى مخطط امتدادات غير مكشوف، بعد اختبار التوافق.
- لا يوجد secret أو service-role key في الكود أو التقارير.

مرجع RLS الرسمي: https://supabase.com/docs/guides/database/postgres/row-level-security

### الأداء

- Performance Advisor كشف 10 مفاتيح أجنبية غير مغطاة بفهرس: `audit_logs.merchant_id`; `cart_items.product_id`; `carts.customer_id` و`carts.merchant_id`; `order_items.order_id` و`order_items.product_id`; `orders.customer_id` و`orders.merchant_id`; `payment_receipts.order_id`; `whatsapp_messages.customer_id`.
- أشار Advisor إلى 3 فهارس غير مستخدمة: `products_merchant_active_idx`, `products_embedding_hnsw_idx`, `whatsapp_messages_processing_idx`. القاعدة فارغة ولم يبدأ حمل فعلي، لذلك لا نحذفها قبل اختبار أحمال حقيقية.
- Health Advisor لم يرجع ملاحظات.

روابط المعالجة:  
- https://supabase.com/docs/guides/observability/advisors?lint=0008_rls_enabled_no_policy  
- https://supabase.com/docs/guides/observability/advisors?lint=0001_unindexed_foreign_keys  
- https://supabase.com/docs/guides/observability/advisors?lint=0014_extension_in_public

## 5. ملاحظة PDR

يحدد PDR نطاقًا واسعًا: 58 شاشة، 42 جدولًا، و65 عقد API. لكن بعض DDL في قاموس البيانات تعيد قالبًا عامًا ولا تعطي تعريفًا تشغيليًا كافيًا لكل كيان. لا تُنشئ 42 جدولًا آليًا من هذه القوالب. استخرج الكيانات من مواصفات الشاشات وعقود API والتدفقات، ثم اختبرها.

## 6. مراحل العمل التالية

1. **معمارية مستقلة:** تصميم مخطط `ibb` دون لمس `public` الحالي، مع تعريف مالك السجل وحالات الاعتماد والحي/الموقع.
2. **عقود API:** كتابة mapping بين نقاط Worker الحالية وجداول `ibb` المقترحة، مع الحفاظ على شكل الاستجابات.
3. **RLS:** تحديد القراءة العامة للمنشآت المعتمدة فقط، وإرسال المساهمات عبر قواعد تحقق/مراجعة؛ ربط صلاحيات الإدارة بهوية خادمية موثوقة. لا تستند إلى `user_metadata`.
4. **Migration/اختبارات:** إنشاء migration عبر Supabase CLI وفق الإجراء الرسمي، وتشغيل اختبارات RLS وقيود التكرار والفهارس على بيئة محلية/معزولة قبل اعتمادها.
5. **ربط Worker:** استخدام credential خادمي محفوظ في Cloudflare Secrets أو Edge Function، وعدم إرسال service-role للمتصفح.
6. **Shadow reads:** مقارنة نتائج القراءة بين D1 والمخطط الجديد، ثم نسخ البيانات على دفعات مع checksums وإمكانية استئناف.
7. **التحويل:** بعد نجاح الاختبارات فقط، حوّل واجهات API تدريجيًا مع خطة rollback ومراقبة. لا كتابة مزدوجة.

## 7. ما لم يتم

- لم يتم تطبيق DDL أو إنشاء مخطط `ibb` في Supabase.
- لم يتم إنشاء أو تغيير سياسات RLS أو منح الصلاحيات.
- لم يتم تثبيت PostGIS أو نقل امتداد vector.
- لم يتم ربط Worker فعليًا بـ Supabase؛ لا يوجد credential خادمي منشور لهذا الربط.
- لم يتم ترحيل بيانات D1 أو الأرشيف.
- لم يتغير `main` أو نشر Cloudflare Worker إنتاجي في هذه الدفعة.

**الخلاصة:** الاتصال الحي والجرد اكتملَا، لكن ربط التطبيق لم يكتمل بعد. البوابة التالية هي اعتماد تصميم `ibb` المنفصل وعقود التحويل والاختبارات قبل أي تغيير في قاعدة الإنتاج.

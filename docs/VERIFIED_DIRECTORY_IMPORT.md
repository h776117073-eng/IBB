# استيراد ملف المراجعة المعتمد إلى دليل إب

## ما يضيفه الملف
يقوم scripts/import_verified_google_review.py بتحويل ملف google_search_review_all.csv إلى أجزاء JSON ضمن data/verified-profiles/. يطابق السكربت كل صف مع اسم المصدر في data/store-names-*.json بحسب record_number وoriginal_name، ويرفض الاستيراد إذا اختلف الترتيب أو ظهر سجل غير معلّم match.

## طريقة الاستيراد
من جذر المستودع:

\`\`\`bash
python scripts/import_verified_google_review.py /path/to/google_search_review_all.csv
python -m py_compile scripts/import_verified_google_review.py
node scripts/validate.mjs
\`\`\`

ينتج:
- data/verified-profiles/index.json
- verified-profiles-001.json إلى verified-profiles-023.json
- import-summary.json

## نشر الحزمة من GitHub
يمكن رفع ملف data/verified-profiles-import.zip إلى المستودع. يقوم سير عمل Pages بفكها إلى data/verified-profiles/ والتحقق منها قبل النشر.

## قواعد سلامة البيانات
- المفتاح الفريد هو record_id، وليس verified_place_id.
- أسماء السجلات المعتمدة قد تتكرر؛ لا نحذف التكرارات ولا ندمج الفروع تلقائيًا.
- rating وreviews_count يبقيان نصوصًا كما في المصدر؛ بعض القيم مركبة ولا يجوز فرض تحويل رقمي عليها.
- الملف لا يحتوي على latitude أو longitude. العنوان النصي وPlus Code ورابط خرائط Google لا تُحوّل إلى دبوس جغرافي تلقائي.
- المراجعة في الملف لا تثبت أن النشاط ما زال مفتوحًا، ولا تثبت ملكية النشاط أو توفر المنتجات والأسعار.
- لا تُعرض بيانات ملكية موثقة أو حالة فتح لحظية دون مصدر منفصل وتاريخ تحقق.

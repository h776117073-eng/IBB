#!/usr/bin/env python3
"""Build a human-driven Google Search review pack for all Ibb source names.

No Google requests are sent by this program. It only generates URLs for
reviewers to open interactively in their browser. No API key is required.
"""
from __future__ import annotations
import argparse, csv, html, json, math, sys, urllib.parse, zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "data/index.json"
OUT_DIR = ROOT / "out/google_search_review"
FIELDS = ["record_number","record_id","name","google_search_query","google_search_url","google_maps_search_url","review_status","review_notes"]
STATUSES = [("not_reviewed","لم يراجع"),("match","مطابق"),("mismatch","غير مطابق"),("no_result","لم تظهر نتيجة مناسبة"),("uncertain","بحاجة إلى مراجعة إضافية")]

def load_names():
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    names = []
    for chunk in index.get("chunks", []):
        path = ROOT / "data" / chunk
        values = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(values, list):
            raise ValueError(f"Expected list in {path}")
        names.extend(str(v).strip() for v in values if isinstance(v,str) and v.strip())
    expected = int(index.get("totalRecords",len(names)))
    if len(names) != expected:
        raise ValueError(f"Expected {expected} names, loaded {len(names)}")
    return names, str(index.get("sourceFile","IBB source names"))

def query_for(name):
    return f'"{name}" إب اليمن'

def search_url(name):
    return "https://www.google.com/search?" + urllib.parse.urlencode({"q":query_for(name),"hl":"ar","gl":"YE","num":"10"})

def maps_url(name):
    return "https://www.google.com/maps/search/?" + urllib.parse.urlencode({"api":"1","query":f"{name} إب اليمن"})

def make_row(n,name):
    return {"record_number":str(n),"record_id":f"ibb-source-{n:05d}","name":name,
            "google_search_query":query_for(name),"google_search_url":search_url(name),
            "google_maps_search_url":maps_url(name),"review_status":"not_reviewed","review_notes":""}

def write_csv(path,rows):
    with path.open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=FIELDS,extrasaction="ignore")
        w.writeheader(); w.writerows(rows)

def render_page(page,total_pages,rows,start,total):
    body=[]
    for r in rows:
        num=html.escape(r["record_number"])
        body.append(
          '<tr data-id="'+html.escape(r["record_id"])+'">'
          '<td>'+num+'</td><td class="name">'+html.escape(r["name"])+'</td>'
          '<td><a target="_blank" rel="noopener" href="'+html.escape(r["google_search_url"],quote=True)+'">بحث Google</a></td>'
          '<td><a target="_blank" rel="noopener" href="'+html.escape(r["google_maps_search_url"],quote=True)+'">خرائط Google</a></td>'
          '<td><select class="status" aria-label="حالة السجل '+num+'">'+
          ''.join('<option value="'+v+'">'+label+'</option>' for v,label in STATUSES)+'</select></td>'
          '<td><input class="notes" maxlength="500" placeholder="ملاحظة أو مصدر مستقل"></td></tr>'
        )
    prev = '<a href="page-%03d.html">السابق</a>'%(page-1) if page>1 else ""
    nxt = '<a href="page-%03d.html">التالي</a>'%(page+1) if page<total_pages else ""
    return f"""<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>مراجعة أسماء إب — {page}</title>
<style>
body{{font-family:system-ui,sans-serif;margin:18px;line-height:1.55}}main{{max-width:1200px;margin:auto}}
table{{border-collapse:collapse;width:100%;min-width:900px}}th,td{{border-bottom:1px solid #8885;padding:8px;text-align:right}}
th{{position:sticky;top:0;background:#eee;color:#111}}.wrap{{overflow:auto;border:1px solid #8885;border-radius:10px}}
.name{{min-width:210px;font-weight:600}}a,button{{display:inline-block;padding:7px 10px;border-radius:7px;background:#2563eb;color:white;text-decoration:none;border:0}}
select,input{{padding:7px;max-width:220px}}.muted{{opacity:.7}}.bar{{height:8px;border:1px solid #8888;border-radius:20px;margin:12px 0}}#fill{{height:100%;background:#16a34a;width:0}}
</style></head><body><main>
<h2>مراجعة الأسماء الأصلية لمدينة إب</h2>
<p class="muted">الصفحة {page}/{total_pages} — السجلات {start} إلى {start+len(rows)-1} من {total}</p>
<p class="muted">افتح نتائج Google يدوياً. الحقول أدناه تحفظ الحالة والملاحظات في هذا المتصفح فقط.</p>
<p id="progress">جارٍ حساب التقدم…</p><div class="bar"><div id="fill"></div></div>
<button id="export">تصدير الصفحة CSV</button> <button id="clear">مسح حالات الصفحة</button>
<p>{prev} <a href="index.html">الفهرس</a> {nxt}</p>
<div class="wrap"><table><thead><tr><th>#</th><th>الاسم الأصلي</th><th>بحث الويب</th><th>خرائط</th><th>الحالة</th><th>ملاحظات</th></tr></thead>
<tbody>{''.join(body)}</tbody></table></div>
<p class="muted">رابط البحث ليس نتيجة بحث. لا تسجل «مطابق» إلا بعد التحقق أن النتيجة تخص المنشأة أو المعلم المقصود في إب.</p>
</main><script>
(function(){{
const key="ibb-review-page-{page:03d}";
const rows=Array.from(document.querySelectorAll("tbody tr"));
let saved={{}};
try{{saved=JSON.parse(localStorage.getItem(key)||"{{}}");}}catch(e){{saved={{}};}}
function update(){{
let done=0;
rows.forEach(r=>{{const s=r.querySelector(".status");if(s.value!=="not_reviewed")done++;}});
document.getElementById("progress").textContent="تمت مراجعة "+done+" من "+rows.length+" في هذه الصفحة";
document.getElementById("fill").style.width=(rows.length?done/rows.length*100:0)+"%";
}}
rows.forEach(r=>{{
const id=r.dataset.id,s=r.querySelector(".status"),n=r.querySelector(".notes");
if(saved[id]){{s.value=saved[id].status||"not_reviewed";n.value=saved[id].notes||"";}}
function persist(){{saved[id]={{status:s.value,notes:n.value}};localStorage.setItem(key,JSON.stringify(saved));update();}}
s.addEventListener("change",persist);n.addEventListener("change",persist);n.addEventListener("blur",persist);
}});
function esc(v){{return '"'+String(v||"").replaceAll('"','""')+'"';}}
document.getElementById("export").onclick=function(){{
const data=[["record_id","name","google_search_url","google_maps_search_url","review_status","review_notes"].map(esc).join(",")];
rows.forEach(r=>data.push([r.dataset.id,r.querySelector(".name").textContent,r.querySelectorAll("a")[0].href,r.querySelectorAll("a")[1].href,r.querySelector(".status").value,r.querySelector(".notes").value].map(esc).join(",")));
const blob=new Blob(["\\ufeff"+data.join("\\r\\n")],{{type:"text/csv;charset=utf-8"}});
const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="review-page-{page:03d}.csv";a.click();URL.revokeObjectURL(url);
}};
document.getElementById("clear").onclick=function(){{
if(!confirm("مسح حالات هذه الصفحة؟"))return;localStorage.removeItem(key);saved={{}};
rows.forEach(r=>{{r.querySelector(".status").value="not_reviewed";r.querySelector(".notes").value="";}});update();
}};
update();
}})();
</script></body></html>"""

def render_index(total,page_size,pages,source,unique):
    links=[]
    for p in range(1,pages+1):
        a=(p-1)*page_size+1;b=min(p*page_size,total)
        links.append(f'<li><a href="page-{p:03d}.html">الصفحة {p:03d}: السجلات {a}–{b}</a></li>')
    return f"""<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>فهرس مراجعة إب</title><style>body{{font-family:system-ui,sans-serif;max-width:850px;margin:24px auto;padding:0 16px;line-height:1.7}}li{{margin:6px 0}}a{{color:#2563eb}}</style>
<body><h1>مراجعة أسماء منشآت ومعالم إب</h1>
<p>إجمالي السجلات: <b>{total:,}</b></p><p>الأسماء المميزة: <b>{unique:,}</b></p>
<p>عدد صفحات المراجعة: {pages:,} — المصدر: {html.escape(source)}</p>
<p><a href="google_search_review_all.csv">تنزيل CSV الكامل</a> | <a href="summary.json">ملخص</a></p>
<p>هذه الحزمة تنشئ روابط فقط؛ لا ترسل أي استعلام آلي إلى Google ولا تحفظ نتائج البحث.</p>
<ol>{''.join(links)}</ol></body></html>"""

def self_test():
    sample="صيدلية الاختبار — إب"
    assert "google.com/search?" in search_url(sample)
    assert "إب" in urllib.parse.unquote(search_url(sample))
    assert "google.com/maps/search/" in maps_url(sample)
    print("SELF_TEST_OK: Google search links, Maps links and Arabic URL encoding; no network requests")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--page-size",type=int,default=250)
    ap.add_argument("--self-test",action="store_true")
    args=ap.parse_args()
    if not 50<=args.page_size<=1000:
        raise ValueError("page-size must be between 50 and 1000")
    if args.self_test:self_test()
    names,source=load_names()
    rows=[make_row(i,n) for i,n in enumerate(names,1)]
    OUT_DIR.mkdir(parents=True,exist_ok=True)
    write_csv(OUT_DIR/"google_search_review_all.csv",rows)
    pages=math.ceil(len(rows)/args.page_size)
    for p in range(1,pages+1):
        start=(p-1)*args.page_size
        chunk=rows[start:start+args.page_size]
        (OUT_DIR/f"page-{p:03d}.html").write_text(render_page(p,pages,chunk,start+1,len(rows)),encoding="utf-8")
    unique=len(set(names)); counts=Counter(names)
    summary={
      "generated_utc":datetime.now(timezone.utc).isoformat(timespec="seconds"),
      "source_file":source,"source_count":len(names),"unique_name_count":unique,
      "duplicate_rows":len(names)-unique,"page_size":args.page_size,"page_count":pages,
      "google_queries_executed":0,"google_search_links_generated":len(rows),
      "google_maps_links_generated":len(rows),"google_results_scraped":False,
      "note":"Links only. Human reviewers open each Google search interactively; no automated Google queries or scraping.",
      "repeated_name_examples":[{"name":n,"count":c} for n,c in counts.most_common(15) if c>1]
    }
    (OUT_DIR/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    (OUT_DIR/"index.html").write_text(render_index(len(rows),args.page_size,pages,source,unique),encoding="utf-8")
    (OUT_DIR/"README.txt").write_text(
      "IBB Google Search review pack\n"
      f"Source records: {len(rows)}\nUnique names: {unique}\nDuplicate rows: {len(rows)-unique}\n"
      "No requests were made to Google. Open links interactively. Review statuses and notes are local to the browser and exportable page by page.\n",
      encoding="utf-8")
    zip_path=ROOT/"out/ibb_google_search_review_pack.zip"
    with zipfile.ZipFile(zip_path,"w",zipfile.ZIP_DEFLATED) as z:
        for path in sorted(OUT_DIR.iterdir()):
            if path.is_file():z.write(path,arcname=path.name)
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    print(f"OUTPUT_ZIP: {zip_path}")

if __name__=="__main__":
    try:main()
    except Exception as e:
        print(f"FATAL: {e}",file=sys.stderr);raise

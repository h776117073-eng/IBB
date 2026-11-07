#!/usr/bin/env python3
"""Join the 50k product index, Arabic translations and Drive image index into D1-ready JSONL."""
from __future__ import annotations
import argparse, csv, gzip, json, re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

CATEGORY_RULES = [
    ("sweet snacks","حلويات"),("confectioneries","حلويات وسكاكر"),("chocolate","شوكولاتة"),
    ("biscuits","بسكويت"),("cakes","كعك وحلويات"),("salted snacks","وجبات خفيفة مالحة"),
    ("snacks","وجبات خفيفة"),("beverages","مشروبات"),("carbonated drinks","مشروبات غازية"),
    ("sodas","مشروبات غازية"),("waters","مياه"),("tea","شاي"),("coffee","قهوة"),
    ("dairies","ألبان ومشتقاتها"),("produits laitiers","ألبان ومشتقاتها"),("milk","حليب"),
    ("cheeses","أجبان"),("fromages","أجبان"),("yogurts","زبادي"),("condiments","توابل وصلصات"),
    ("sauces","صلصات"),("spices","توابل"),("meats","لحوم"),("viandes","لحوم ومشتقاتها"),
    ("chicken","دجاج"),("poultry","دواجن"),("prepared meats","لحوم مجهزة"),("frozen foods","أغذية مجمدة"),
    ("frozen desserts","حلويات مجمدة"),("desserts","حلويات"),("plant-based foods","أغذية نباتية"),
    ("breads","مخبوزات"),("cereals","حبوب"),("pastas","معكرونة"),("pasta","معكرونة"),
    ("noodles","نودلز"),("canned foods","أغذية معلبة"),("soups","شوربات"),("meals","وجبات جاهزة"),
    ("olive oils","زيت زيتون"),("oils","زيوت"),("honey","عسل"),("sweeteners","محليات"),
    ("syrups","شراب ومحليات"),("fruits","فواكه"),("vegetables","خضروات"),("breakfast","منتجات الإفطار"),
    ("snacks sucrés","حلويات"),("boissons","مشروبات"),("édulcorants","محليات"),("poulet","دجاج"),
    ("légumes","خضروات"),("fruits","فواكه"),("huiles","زيوت"),("café","قهوة"),("thé","شاي"),
    ("eaux","مياه"),("biscuits","بسكويت")
]
ARABIC_COUNTRIES = ("saudi arabia","united arab emirates","egypt","oman","kuwait","qatar","iraq","jordan","lebanon","palestine","syria","bahrain","السعودية","الإمارات","مصر","اليمن","عمان","الكويت","قطر")

def barcode(value: object) -> str:
    digits=re.sub(r"\D","",str(value or ""))
    return digits.zfill(13) if digits and len(digits)<=13 else digits

def load_translations(path: str) -> tuple[dict,int]:
    found={}; bad=0
    with open(path,encoding="utf-8-sig") as f:
        for line in f:
            line=line.rstrip("\r\n")
            if line.endswith("\\n"): line=line[:-2]
            if not line: continue
            try:
                row=json.loads(line)
                code=barcode(row.get("code"))
                name=str(row.get("name_ar") or "").strip()
                if code and name: found[code]=name
                else: bad+=1
            except (ValueError,TypeError):
                bad+=1
    return found,bad

def load_images(path: str) -> dict:
    opener=gzip.open if path.endswith(".gz") else open
    with opener(path,"rt",encoding="utf-8") as f:
        data=json.load(f)
    return {barcode(x.get("barcode")):x for x in data.get("items",[]) if x.get("barcode")}

def arabic_category(value: str) -> str:
    raw=str(value or "").strip()
    if not raw or raw.lower() in ("undefined","nan","none"):
        return "غير مصنف"
    low=raw.lower()
    for token,label in CATEGORY_RULES:
        if token in low:
            return label
    return "غير مصنف"

def country_relevance(value: str) -> str:
    low=str(value or "").lower()
    if "yemen" in low or "اليمن" in low: return "YEMEN"
    if any(x in low for x in ARABIC_COUNTRIES): return "ARABIC_REGION"
    if not low.strip() or low.strip()=="undefined": return "UNKNOWN"
    return "FOREIGN"

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--index",required=True)
    parser.add_argument("--translations",required=True)
    parser.add_argument("--image-index",required=True)
    parser.add_argument("--output-dir",required=True)
    parser.add_argument("--limit",type=int,default=0)
    args=parser.parse_args()
    translations,bad=load_translations(args.translations)
    images=load_images(args.image_index)
    out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    now=datetime.now(timezone.utc).isoformat()
    all_rows=[]; image_queue=[]; review=[]
    seen=set()
    with open(args.index,encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        for i,row in enumerate(reader):
            if args.limit and i>=args.limit: break
            code=barcode(row.get("code"))
            if not code or code in seen: continue
            seen.add(code)
            name_source=str(row.get("product_name") or "").strip()
            brand=str(row.get("brands") or "").strip()
            category_source=str(row.get("categories") or "").strip()
            countries=str(row.get("countries") or "").strip()
            name_ar=translations.get(code,"منتج غير مترجم")
            image=images.get(code)
            category_ar=arabic_category(category_source)
            translated=code in translations
            has_image=bool(image)
            image_status="PENDING" if has_image else "MISSING"
            quality="PUBLISHED" if translated and has_image and category_ar!="غير مصنف" else "CANDIDATE"
            image_url=str(row.get("image_url") or "").strip()
            record={
                "barcode":code,"name_source":name_source,"name_ar":name_ar,
                "brand_source":brand,"brand_ar":brand,"category_source":category_source,
                "category_ar":category_ar,
                "description_ar":("منتج مرجعي من فئة "+category_ar+"؛ لا يثبت توفره لدى أي متجر.") if category_ar!="غير مصنف" else "منتج مرجعي غير مصنف؛ لا يثبت توفره المحلي.",
                "image_key":code if has_image else "",
                "image_source_url":image_url,
                "image_drive_file_id":str(image.get("file_id") or "") if image else "",
                "image_status":image_status,"quality_status":quality,
                "translation_status":"MODEL_TRANSLATED" if translated else "NEEDS_TRANSLATION",
                "availability_status":"REFERENCE_ONLY",
                "country_relevance":country_relevance(countries),
                "countries_source":countries,
                "source_name":"Open Food Facts",
                "source_url":"https://world.openfoodfacts.org/product/"+code,
                "country_code":"","created_at":now,"updated_at":now
            }
            all_rows.append(record)
            if has_image:
                image_queue.append({"barcode":code,"drive_file_id":str(image.get("file_id") or ""),"filename":str(image.get("filename") or ""),"source_url":image_url,"target_key":"products/"+code+".webp","target_format":"webp"})
            if not translated or not has_image or category_ar=="غير مصنف":
                review.append({"barcode":code,"name_source":name_source,"name_ar":name_ar,"category_source":category_source,"country_relevance":record["country_relevance"],"translated":translated,"image_available":has_image,"review_reason":";".join(x for x,ok in [("needs_translation",not translated),("missing_image",not has_image),("unclassified_category",category_ar=="غير مصنف")] if ok)})
    with open(out/"catalog_products.jsonl","w",encoding="utf-8") as f:
        for row in all_rows:f.write(json.dumps(row,ensure_ascii=False)+"\n")
    with open(out/"product_image_import_queue.jsonl","w",encoding="utf-8") as f:
        for row in image_queue:f.write(json.dumps(row,ensure_ascii=False)+"\n")
    with open(out/"catalog_review_queue.csv","w",encoding="utf-8-sig",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=["barcode","name_source","name_ar","category_source","country_relevance","translated","image_available","review_reason"])
        writer.writeheader();writer.writerows(review)
    summary={
        "source_products":len(all_rows),"unique_barcodes":len(seen),"valid_translations":len(translations),
        "corrupt_translation_rows_skipped":bad,"products_with_drive_images":len(image_queue),
        "published_reference_products":sum(x["quality_status"]=="PUBLISHED" for x in all_rows),
        "candidate_products":sum(x["quality_status"]=="CANDIDATE" for x in all_rows),
        "country_relevance":dict(Counter(x["country_relevance"] for x in all_rows)),
        "category_ar":dict(Counter(x["category_ar"] for x in all_rows).most_common(30)),
        "availability_policy":"REFERENCE_ONLY for every product; none is local stock until a merchant confirms it."
    }
    (out/"catalog_products_summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()

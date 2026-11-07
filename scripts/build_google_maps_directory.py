#!/usr/bin/env python3
"""Build a provenance-preserving Ibb directory import from Google Maps CSV exports."""
from __future__ import annotations
import argparse, csv, hashlib, json, re, unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

CATEGORY_AR = {
    "Grocery store":"بقالة","Pharmacy":"صيدلية","Supermarket":"سوبرماركت","Electronics store":"متجر إلكترونيات",
    "Clothing store":"متجر ملابس","Restaurant":"مطعم","Market":"سوق","Cell phone store":"متجر هواتف",
    "Mobile phone repair shop":"صيانة الهواتف","Coffee shop":"مقهى","Bakery":"مخبز","Shopping mall":"مركز تجاري",
    "Auto parts store":"قطع غيار سيارات","Women's clothing store":"ملابس نسائية","Travel agency":"وكالة سفر وسياحة",
    "Store":"متجر","Furniture store":"متجر أثاث","Building materials store":"مواد بناء","Shoe store":"متجر أحذية",
    "Internet cafe":"مقهى إنترنت","Jewelry store":"متجر مجوهرات","Hardware store":"أدوات ومواد بناء",
    "Buffet restaurant":"مطعم بوفيه","Mattress store":"متجر مراتب","Fast food restaurant":"مطعم وجبات سريعة",
    "Cosmetics store":"متجر مستحضرات تجميل","Auto repair shop":"ورشة صيانة سيارات","Motorcycle parts store":"قطع غيار دراجات نارية",
    "Convenience store":"متجر تموينات","Cafe":"مقهى","Gift shop":"متجر هدايا","Home goods store":"متجر مستلزمات منزلية",
    "Gym":"نادي رياضي","Software company":"شركة برمجيات","Tire shop":"متجر إطارات","Ice cream shop":"متجر مثلجات",
    "Fruit and vegetable store":"متجر خضروات وفواكه","Upholstery shop":"تنجيد أثاث","Laundry service":"مغسلة",
    "Motorcycle repair shop":"ورشة دراجات نارية","Auto parts market":"سوق قطع غيار","Computer store":"متجر حاسوب",
    "Hotel":"فندق","Men's clothing store":"ملابس رجالية","Confectionery store":"متجر حلويات","Laundry":"مغسلة ملابس",
    "Perfume store":"متجر عطور","General store":"متجر عام","Children's clothing store":"ملابس أطفال",
    "Natural goods store":"منتجات طبيعية","Chicken restaurant":"مطعم دجاج","Chicken shop":"متجر دجاج",
    "Print shop":"مطبعة","Nut store":"متجر مكسرات","Car dealer":"معرض سيارات","Tobacco shop":"متجر تبغ",
    "Library":"مكتبة","Electrical supply store":"مستلزمات كهربائية","Cell phone accessory store":"إكسسوارات هواتف",
    "Men's tailor":"خياط رجالي","Candy store":"متجر حلوى","Gourmet grocery store":"بقالة متخصصة",
    "Greengrocer":"خضري","Falafel restaurant":"مطعم فلافل","Kitchen supply store":"أدوات مطبخ",
    "Public library":"مكتبة عامة","Beauty supply store":"مستلزمات تجميل","Auto electrical service":"كهرباء سيارات",
    "Cafeteria":"كافتيريا","Corporate office":"مكتب شركة","Tile store":"متجر بلاط","Barber shop":"حلاق",
    "College":"كلية","Computer support and services":"خدمات دعم الحاسوب","Sewing shop":"محل خياطة",
    "Seafood restaurant":"مطعم مأكولات بحرية","Produce market":"سوق خضروات وفواكه","Goldsmith":"صائغ",
    "Butcher shop":"ملحمة","Discount supermarket":"سوبرماركت مخفض","Gold dealer":"تاجر ذهب",
    "Electronics repair shop":"صيانة إلكترونيات","Car rental agency":"تأجير سيارات","Park":"حديقة",
    "Lapidary":"محل أحجار كريمة","Wholesale bakery":"مخبز جملة","Chauffeur service":"خدمة سائق",
    "Wholesaler":"تاجر جملة","Outlet mall":"مركز تسوق","Vegetable wholesale market":"سوق خضروات جملة",
    "Dressmaker":"خياطة ملابس","E-commerce service":"خدمة تجارة إلكترونية","Internet service provider":"مزود إنترنت",
    "Fresh food market":"سوق أغذية طازجة","Brunch restaurant":"مطعم وجبات صباحية","Agricultural service":"خدمات زراعية",
    "Small plates restaurant":"مطعم أطباق صغيرة","Spice store":"متجر توابل","Book store":"متجر كتب",
    "Car battery store":"متجر بطاريات سيارات","Auto machine shop":"ورشة خراطة سيارات","Mechanic":"ميكانيكي",
    "Hair salon":"صالون تجميل","Asian grocery store":"بقالة آسيوية","Furniture wholesaler":"تاجر أثاث جملة",
    "Building materials market":"سوق مواد بناء","Toy store":"متجر ألعاب","Sweets and dessert buffet":"بوفيه حلويات",
    "Barbecue restaurant":"مطعم مشويات","Diner":"مطعم شعبي","Souvenir store":"متجر تذكارات",
    "Tourist attraction":"مزار سياحي","Paint store":"متجر دهانات","Building materials supplier":"مورد مواد بناء",
    "School":"مدرسة","Hospital":"مستشفى","University":"جامعة","Government office":"مكتب حكومي",
    "Police station":"مركز شرطة","Post office":"مكتب بريد","Mosque":"مسجد","Church":"كنيسة",
    "Historical landmark":"معلم تاريخي","Cemetery":"مقبرة","Museum":"متحف","Neighborhood":"حي"
}
PUBLIC_CATEGORIES = ("school","hospital","clinic","university","college","library","government","police","post office","public service")
LANDMARK_CATEGORIES = ("mosque","church","place of worship","park","tourist attraction","historical","cemetery","museum","monument")
STREET_CATEGORIES = ("street","road","bridge","highway","intersection")
NEIGHBORHOOD_CATEGORIES = ("neighborhood","locality","sublocality","residential area")
PLACEHOLDERS = {".","ibb","yemen ibb","ibb yemen","محافظة إب","مدينة إب"}

def text(value: object) -> str:
    return str(value or "").strip()

def parse_json(value: object, fallback):
    raw = text(value)
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return fallback

def normalize_arabic(value: object) -> str:
    value = unicodedata.normalize("NFKC", text(value)).lower()
    value = re.sub(r"[\u064b-\u065f\u0670\u0640]", "", value)
    value = value.translate(str.maketrans({"أ":"ا","إ":"ا","آ":"ا","ى":"ي","ؤ":"و","ئ":"ي"}))
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()

def safe_url(value: object) -> str:
    value = text(value)
    return value if value.startswith(("https://","http://")) else ""

def first_email(value: object) -> str:
    parsed = parse_json(value, None)
    if isinstance(parsed, list):
        for item in parsed:
            candidate = text(item.get("email") if isinstance(item, dict) else item)
            if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", candidate):
                return candidate
    raw = text(value)
    match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", raw)
    return match.group(0) if match else ""

def first_image(value: object) -> str:
    parsed = parse_json(value, None)
    candidates = parsed if isinstance(parsed, list) else [parsed] if isinstance(parsed, dict) else [value]
    for item in candidates:
        candidate = item.get("url") or item.get("image_url") or item.get("image") or item.get("src") if isinstance(item, dict) else item
        url = safe_url(candidate)
        if url:
            return url
    return ""

def classify_kind(name: str, category: str) -> str:
    n, c = normalize_arabic(name), text(category).lower()
    if any(x in n for x in ("شارع","طريق","جسر","نفق","دوار","جولة","خط الثلاثين","خط")) or any(x in c for x in STREET_CATEGORIES):
        return "STREET"
    if any(x in n for x in ("حارة","حي ","قرية","عزلة","محلة")) or any(x in c for x in NEIGHBORHOOD_CATEGORIES):
        return "NEIGHBORHOOD"
    if any(x in n for x in ("جامع","مسجد","مقبرة","مزار","متحف","حديقة","قلعة","حصن","أثر")) or any(x in c for x in LANDMARK_CATEGORIES):
        return "LANDMARK"
    if any(x in n for x in ("مستشفى","مركز صحي","مستوصف","مدرسة","جامعة","كلية","مكتب حكومي","مركز شرطة")) or any(x in c for x in PUBLIC_CATEGORIES):
        return "PUBLIC_SERVICE"
    return "BUSINESS" if text(category) else "OTHER"

def format_address(address: dict, plus_code: str) -> tuple[str,str,str]:
    street = text(address.get("street") or address.get("route"))
    borough = text(address.get("borough") or address.get("neighborhood") or address.get("sublocality"))
    city = text(address.get("city") or address.get("locality"))
    country = text(address.get("country"))
    city_ar = "إب" if city.lower() in ("ibb","ibb city") or city == "إب" else city
    country_ar = "اليمن" if country.upper() in ("YE","YEMEN") or country == "اليمن" else country
    parts = []
    for part in (street, borough, city_ar, country_ar):
        if part and part not in parts:
            parts.append(part)
    if not parts and plus_code:
        parts.append(plus_code)
    district = text(address.get("state") or address.get("administrative_area_level_1"))
    if district.lower() in ("ibb","ibb governorate"):
        district = "محافظة إب"
    return "، ".join(parts), borough, district

def build_records(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    coords = Counter()
    parsed = []
    for row in rows:
        try:
            lat, lon = float(row.get("latitude") or ""), float(row.get("longitude") or "")
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                coords[(round(lat,6),round(lon,6))] += 1
        except (TypeError, ValueError):
            pass
        parsed.append(row)
    now = datetime.now(timezone.utc).isoformat()
    output, review = [], []
    for index, row in enumerate(parsed, start=1):
        name = text(row.get("name"))
        category_source = text(row.get("category"))
        place_id = text(row.get("place_id"))
        address_obj = parse_json(row.get("address"), {})
        if not isinstance(address_obj, dict):
            address_obj = {}
        plus_code = text(row.get("plus_code"))
        address, neighborhood, district = format_address(address_obj, plus_code)
        try:
            lat, lon = float(row.get("latitude") or ""), float(row.get("longitude") or "")
            coords_valid = -90 <= lat <= 90 and -180 <= lon <= 180
        except (TypeError, ValueError):
            lat, lon, coords_valid = None, None, False
        coord_count = coords[(round(lat,6),round(lon,6))] if coords_valid else 0
        city = text(address_obj.get("city") or address_obj.get("locality")).lower()
        country = text(address_obj.get("country")).upper()
        city_scope = ("ibb" in city or "إب" in city or country in ("YE","YEMEN","اليمن")) and coords_valid and 13.7 <= lat <= 14.2 and 43.9 <= lon <= 44.5
        placeholder = normalize_arabic(name) in {normalize_arabic(x) for x in PLACEHOLDERS}
        kind = classify_kind(name, category_source)
        category = CATEGORY_AR.get(category_source, "نشاط تجاري" if kind == "BUSINESS" else "موقع")
        valid_identity = bool(place_id and name and category_source and not placeholder)
        publish = bool(valid_identity and city_scope)
        location_precision = "MISSING" if not coords_valid else "APPROXIMATE" if coord_count > 1 else "EXACT"
        location_status = "MISSING" if not coords_valid else "APPROXIMATE" if coord_count > 1 else "EXACT"
        operational_raw = text(row.get("status")).upper()
        operational = "CLOSED" if operational_raw == "CLOSED" else "OPEN" if operational_raw == "OPEN" else "UNKNOWN"
        hours = parse_json(row.get("opening_hours"), {})
        if not isinstance(hours, (dict,list)):
            hours = {}
        images_url = first_image(row.get("images"))
        description = text(row.get("description")) or text(row.get("about"))
        if len(description) > 1200:
            description = description[:1200]
        rating = None
        try:
            value = float(row.get("rating") or 0)
            count = int(float(row.get("review_count") or 0))
            rating = value if count > 0 and 0 < value <= 5 else None
        except (TypeError, ValueError):
            count = 0
        raw_hash = hashlib.sha256(json.dumps(row,ensure_ascii=False,sort_keys=True,default=str).encode()).hexdigest()
        source_record_id = place_id or "row-" + str(index)
        record = {
            "id": "gmaps_" + place_id if place_id else "gmap_row_" + str(index),
            "source_file": "gosom.csv",
            "source_record_id": source_record_id,
            "name": name,
            "name_norm": normalize_arabic(name),
            "kind": kind,
            "category": category,
            "category_norm": normalize_arabic(category),
            "source_category": category_source,
            "address": address or text(row.get("address")),
            "address_norm": normalize_arabic(address or text(row.get("address"))),
            "district": district,
            "neighborhood": neighborhood,
            "phone": text(row.get("phone")),
            "email": first_email(row.get("emails")),
            "website_url": safe_url(row.get("website")),
            "description": description,
            "cover_image_url": images_url,
            "opening_hours_json": json.dumps(hours,ensure_ascii=False,separators=(",",":")),
            "rating": rating,
            "review_count": count,
            "operational_status": operational,
            "latitude": lat if coords_valid else None,
            "longitude": lon if coords_valid else None,
            "geometry_type": "POINT",
            "geometry_json": "",
            "location_precision": location_precision,
            "identity_status": "VERIFIED_MATCH" if valid_identity else "PARTIAL_MATCH",
            "location_status": location_status,
            "verification_status": "VERIFIED_MATCH" if publish else "PARTIAL_MATCH",
            "visibility_status": "PUBLISHED" if publish else "NEEDS_REVIEW",
            "is_commercial": 1 if kind == "BUSINESS" else 0,
            "is_public": 0 if kind == "BUSINESS" else 1,
            "place_id": place_id,
            "plus_code": plus_code,
            "osm_source_id": text(row.get("osm_source_id")),
            "maps_url": safe_url(row.get("google_maps_url")),
            "source_name": "خرائط Google",
            "source_status": text(row.get("status")),
            "source_url": safe_url(row.get("google_maps_url")),
            "source_hash": raw_hash,
            "created_at": now,
            "updated_at": now
        }
        output.append(record)
        if not publish:
            reasons = []
            if not place_id: reasons.append("missing_google_place_id")
            if not coords_valid: reasons.append("missing_coordinates")
            if placeholder: reasons.append("placeholder_name")
            if not category_source: reasons.append("missing_category")
            if not city_scope: reasons.append("outside_or_unconfirmed_city_scope")
            review.append({"id":record["id"],"name":name,"source_category":category_source,"address":record["address"],"latitude":record["latitude"],"longitude":record["longitude"],"reason":";".join(reasons)})
    return output, review

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Google Maps CSV, e.g. gosom.csv")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    out_dir = Path(args.output_dir); out_dir.mkdir(parents=True,exist_ok=True)
    with open(args.input,encoding="utf-8-sig",newline="") as f:
        rows = list(csv.DictReader(f))
    records, review = build_records(rows)
    published = [r for r in records if r["visibility_status"] == "PUBLISHED"]
    for filename, data in (("directory_places_all.jsonl",records),("directory_places_published.jsonl",published)):
        with open(out_dir/filename,"w",encoding="utf-8") as f:
            for row in data: f.write(json.dumps(row,ensure_ascii=False)+"\n")
    with open(out_dir/"directory_places_review.csv","w",encoding="utf-8-sig",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=["id","name","source_category","address","latitude","longitude","reason"])
        writer.writeheader(); writer.writerows(review)
    counts=Counter(r["kind"] for r in records)
    summary={
        "source_file":Path(args.input).name,"total":len(records),"published":len(published),"needs_review":len(review),
        "kinds":dict(counts),"exact_locations":sum(r["location_precision"]=="EXACT" for r in records),
        "approximate_locations":sum(r["location_precision"]=="APPROXIMATE" for r in records),
        "missing_locations":sum(r["location_precision"]=="MISSING" for r in records),
        "closed":sum(r["operational_status"]=="CLOSED" for r in records),
        "with_phone":sum(bool(r["phone"]) for r in records),"with_website":sum(bool(r["website_url"]) for r in records),
        "with_hours":sum(r["opening_hours_json"]!="{}" for r in records),"with_cover_image":sum(bool(r["cover_image_url"]) for r in records),
        "with_rating":sum(r["rating"] is not None for r in records),
        "policy":"Google Place ID + valid Ibb-area coordinates + non-placeholder name/category required for publication; duplicate coordinates are marked approximate."
    }
    (out_dir/"directory_places_summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__ == "__main__":
    main()

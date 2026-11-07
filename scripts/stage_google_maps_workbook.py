#!/usr/bin/env python3
"""Stage the normalized Google Maps workbook sheet without publishing records."""
from __future__ import annotations
import argparse, hashlib, json, re, unicodedata
from collections import Counter
from pathlib import Path
from openpyxl import load_workbook

UNIQUE_SHEET = "الأسماء الفريدة الموحدة 7015"
RAW_SHEET = "جميع السجلات الخام 16441"
HEADER_ROW = 4
BBOX = {"south": 13.7, "north": 14.3, "west": 43.7, "east": 44.5}
PLACE_RE = re.compile(r"(ChI[A-Za-z0-9_-]{10,})")
EMPTY = {"", "غير مدرج", "غير محدد", "nan", "none", "null"}

def norm(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).split())

def clean(value):
    value = norm(value)
    return "" if value.lower() in EMPTY else value

def number(value):
    try:
        result = float(str(value).replace(",", "").strip())
        return result if result == result and abs(result) != float("inf") else None
    except (TypeError, ValueError):
        return None

def read_rows(ws):
    headers = [norm(c.value) for c in ws[HEADER_ROW]]
    if not headers or not headers[0]:
        raise ValueError("Expected headers on Excel row 4")
    result = []
    for row_num, values in enumerate(ws.iter_rows(min_row=HEADER_ROW + 1, values_only=True), HEADER_ROW + 1):
        if any(v is not None and str(v).strip() for v in values):
            result.append((row_num, dict(zip(headers, values))))
    return result

def convert(source: Path, out: Path, chunk_size=500):
    wb = load_workbook(source, read_only=True, data_only=True)
    if UNIQUE_SHEET not in wb.sheetnames or RAW_SHEET not in wb.sheetnames:
        raise ValueError("Expected unique and raw source sheets are missing")
    unique = read_rows(wb[UNIQUE_SHEET])
    raw = read_rows(wb[RAW_SHEET])
    if len(unique) != 7015 or len(raw) != 16441:
        raise ValueError(f"Unexpected source counts: unique={len(unique)}, raw={len(raw)}")
    records, ids, names = [], set(), Counter()
    inside = outside = phones = maps_urls = 0
    for seq, (excel_row, row) in enumerate(unique, 1):
        name = clean(row.get("الاسم الكامل (Title)"))
        if not name:
            raise ValueError(f"Missing business name at Excel row {excel_row}")
        blob = clean(row.get("معرف المكان (Place ID) والأرشيف"))
        match = PLACE_RE.search(blob)
        place_id = match.group(1) if match else ""
        if not place_id or place_id in ids:
            raise ValueError(f"Missing or duplicate Place ID at Excel row {excel_row}")
        ids.add(place_id)
        lat, lon = number(row.get("خط العرض (Lat)")), number(row.get("خط الطول (Lon)"))
        valid = lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180
        in_bbox = valid and BBOX["south"] <= lat <= BBOX["north"] and BBOX["west"] <= lon <= BBOX["east"]
        if in_bbox:
            inside += 1
            api_lat, api_lon, precision, location_status = lat, lon, "APPROXIMATE", "APPROXIMATE"
        else:
            outside += 1
            api_lat = api_lon = None
            precision = location_status = "MISSING"
        phone = clean(row.get("رقم الهاتف (Phone)"))
        maps_url = clean(row.get("رابط خرائط Google"))
        phones += bool(phone)
        maps_urls += bool(maps_url)
        names[name] += 1
        records.append({
            "id": "gmaps-" + hashlib.sha256(place_id.encode()).hexdigest()[:24],
            "source_file": source.name,
            "source_record_id": f"unique-sheet-row-{seq}",
            "name": name, "name_norm": norm(name).lower(),
            "kind": "BUSINESS",
            "category": clean(row.get("التصنيف بالعربية")),
            "category_norm": norm(row.get("التصنيف بالعربية")).lower(),
            "source_category": clean(row.get("التصنيف الأصلي (Category)")),
            "address": clean(row.get("العنوان التفصيلي (Address)")),
            "address_norm": norm(row.get("العنوان التفصيلي (Address)")).lower(),
            "district": clean(row.get("الشارع / الحي")),
            "neighborhood": clean(row.get("المدينة / النطاق")),
            "phone": phone, "email": "", "website_url": "", "description": "",
            "cover_image_url": "", "opening_hours_json": "{}",
            "rating": number(row.get("التقييم")),
            "review_count": max(0, int(number(row.get("التقييمات")) or 0)),
            "operational_status": "UNKNOWN",
            "latitude": api_lat, "longitude": api_lon,
            "geometry_type": "POINT", "geometry_json": "",
            "location_precision": precision,
            "identity_status": "UNVERIFIED",
            "location_status": location_status,
            "verification_status": "UNVERIFIED",
            "visibility_status": "NEEDS_REVIEW",
            "is_commercial": 1, "is_public": 0,
            "place_id": place_id,
            "plus_code": clean(row.get("كود الموقع (Plus Code)")),
            "osm_source_id": "", "maps_url": maps_url,
            "source_name": "GOOGLE_MAPS_ARCHIVE_WORKBOOK",
            "source_status": "ARCHIVE_EXTRACTED_NOT_INDEPENDENTLY_REVIEWED",
            "source_url": "",
            "source_hash": hashlib.sha256(json.dumps(row, ensure_ascii=False, default=str, sort_keys=True).encode()).hexdigest()
        })
    out.mkdir(parents=True, exist_ok=True)
    chunks = []
    for offset in range(0, len(records), chunk_size):
        filename = f"maps-candidates-{offset // chunk_size + 1:03d}.json"
        (out / filename).write_text(json.dumps(records[offset:offset+chunk_size], ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        chunks.append(filename)
    manifest = {
        "schemaVersion": 1, "sourceWorkbook": source.name,
        "uniqueSheetRecords": len(records), "rawSheetRecordsAuditedButNotExported": len(raw),
        "rawSheetRecordsImported": 0, "uniquePlaceIds": len(ids),
        "uniqueNames": len(names), "duplicateNameRows": len(records)-len(names),
        "recordsWithinApproxIbbBbox": inside,
        "recordsOutsideApproxIbbBboxQuarantinedFromMap": outside,
        "recordsWithPhone": phones, "recordsWithGoogleMapsUrl": maps_urls,
        "recordsPublished": 0, "verificationStatus": "UNVERIFIED",
        "visibilityStatus": "NEEDS_REVIEW", "approximateIbbBbox": BBOX, "chunks": chunks
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "README.md").write_text(
        "# Google Maps workbook staging\n\n"
        "Private review-stage candidates only. All records remain UNVERIFIED and NEEDS_REVIEW. "
        "The raw sheet is counted but never exported. Records outside the approximate Ibb city bbox "
        "have null API coordinates and must be reviewed. A Place ID or archive record is not independent verification.\n",
        encoding="utf-8"
    )
    wb.close()
    return manifest

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--out", type=Path, default=Path("data/staging/google-maps-workbook"))
    parser.add_argument("--chunk-size", type=int, default=500)
    args = parser.parse_args()
    if not 100 <= args.chunk_size <= 1000:
        raise ValueError("chunk-size must be 100..1000")
    print(json.dumps(convert(args.workbook, args.out, args.chunk_size), ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

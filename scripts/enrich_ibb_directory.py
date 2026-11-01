#!/usr/bin/env python3
"""Build a source-traceable Ibb directory export; never infer missing business facts."""
from __future__ import annotations

import base64
import csv
import gzip
import json
import os
import re
import sys
import time
import unicodedata
import zipfile
from pathlib import Path
from typing import Any

import requests
from openlocationcode import openlocationcode as olc
from rapidfuzz import fuzz, process

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
OUT.mkdir(parents=True, exist_ok=True)
IBB_LAT = 13.96667
IBB_LON = 44.18333
# Approximate collection window, NOT an official municipal boundary.
BBOX = tuple(float(x) for x in os.getenv("IBB_BBOX", "13.93,44.12,14.01,44.23").split(","))
UA = "IBB-Market-Research/1.0 (public business directory; contact: repository owner)"
PLUS_RE = re.compile(r"\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b", re.I)
BUSINESS_KEYS = {"shop", "amenity", "office", "tourism", "healthcare", "craft", "leisure", "industrial", "club", "sport"}

FIELDNAMES = [
    "record_id", "record_type", "name", "category", "district", "address", "phone",
    "website", "opening_hours", "rating", "review_count", "plus_code", "latitude",
    "longitude", "source_name", "source_url", "source_status",
    "verification_status", "notes", "google_maps_url", "social_url", "location_confidence", "coordinate_method"
]

def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str] | None = None) -> None:
    names = fields or FIELDNAMES
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=names, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in names})

def load_seed() -> list[dict[str, Any]]:
    p = ROOT / "data/seed/ibb-public-directory-270.json.gz.b64"
    payload = gzip.decompress(base64.b64decode(p.read_text(encoding="ascii")))
    records = json.loads(payload.decode("utf-8"))
    result = []
    for i, row in enumerate(records, start=1):
        address = row.get("العنوان أو الموقع", "")
        codes = PLUS_RE.findall(address or "")
        lat = lon = ""
        plus_code = codes[0].upper() if codes else ""
        coord_source = ""
        if plus_code:
            try:
                full = olc.recoverNearest(plus_code, IBB_LAT, IBB_LON)
                area = olc.decode(full)
                lat, lon = area.latitudeCenter, area.longitudeCenter
                coord_source = "Plus Code decoded; approximate Ibb reference used for short code recovery"
            except Exception:
                lat = lon = ""
        result.append({
            "record_id": f"cybo-seed-{i:04d}",
            "record_type": "public_directory_seed",
            "name": row.get("اسم النشاط التجاري", ""),
            "category": row.get("الفئة / النشاط", ""),
            "address": address,
            "phone": row.get("الهاتف المعلن", ""),
            "plus_code": plus_code,
            "latitude": lat,
            "longitude": lon,
            "source_name": row.get("مصدر مجموعة البيانات", ""),
            "source_url": row.get("رابط المصدر", ""),
            "source_status": row.get("حالة النشاط بحسب المصدر", ""),
            "verification_status": row.get("حالة التحقق الميداني", "غير محدد"),
            "notes": "؛ ".join(x for x in [
                row.get("ملاحظات ومراجعة التكرار", ""),
                row.get("مستوى التحقق الحالي", ""),
                coord_source
            ] if x)
        })
    return result

def load_source_names() -> list[dict[str, Any]]:
    idx = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
    names: list[dict[str, Any]] = []
    for file_name in idx["chunks"]:
        payload = json.loads((ROOT / "data" / file_name).read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise ValueError(f"Unexpected data structure in {file_name}")
        for name in payload:
            if isinstance(name, str) and name.strip():
                names.append({
                    "record_id": f"source-name-{len(names)+1:05d}",
                    "record_type": "source_name_only",
                    "name": name.strip(),
                    "source_name": idx.get("sourceFile", "IBB source names"),
                    "source_url": "https://github.com/h776117073-eng/IBB/tree/main/data",
                    "source_status": "Imported name only",
                    "verification_status": "Name only — not verified as an active establishment",
                    "notes": "No address, phone or coordinates in the source record"
                })
    expected = int(idx.get("totalRecords", len(names)))
    if len(names) != expected:
        raise ValueError(f"Expected {expected} source names, loaded {len(names)}")
    return names

def overpass_query() -> str:
    south, west, north, east = BBOX
    box = f"{south},{west},{north},{east}"
    parts = [f'nwr["name"]["{key}"]({box});' for key in sorted(BUSINESS_KEYS)]
    return "[out:json][timeout:90];(" + "".join(parts) + ");out center tags;"

def fetch_osm() -> list[dict[str, Any]]:
    """Try both public Overpass endpoints once; never stall the rest of the export."""
    query = overpass_query()
    endpoints = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
    ]
    last_error = None
    for endpoint in endpoints:
        try:
            print(f"Querying OSM endpoint: {endpoint}")
            response = requests.post(
                endpoint, data={"data": query},
                headers={"User-Agent": UA}, timeout=(15, 105)
            )
            response.raise_for_status()
            payload = response.json()
            rows = []
            for item in payload.get("elements", []):
                tags = item.get("tags") or {}
                if not any(tags.get(k) for k in BUSINESS_KEYS):
                    continue
                name = tags.get("name:ar") or tags.get("name")
                if not name:
                    continue
                if item.get("type") == "node":
                    lat, lon = item.get("lat"), item.get("lon")
                else:
                    center = item.get("center") or {}
                    lat, lon = center.get("lat"), center.get("lon")
                if lat is None or lon is None:
                    continue
                category_key = next((k for k in BUSINESS_KEYS if tags.get(k)), "")
                address = tags.get("addr:full") or " ".join(
                    x for x in [tags.get("addr:street"), tags.get("addr:housenumber"),
                                tags.get("addr:suburb"), tags.get("addr:city")] if x
                )
                rows.append({
                    "record_id": f"osm-{item.get('type')}-{item.get('id')}",
                    "record_type": "osm_business_feature",
                    "name": name,
                    "category": f"{category_key}={tags.get(category_key, '')}",
                    "district": tags.get("addr:suburb") or tags.get("addr:district", ""),
                    "address": address,
                    "phone": tags.get("contact:phone") or tags.get("phone") or tags.get("contact:mobile", ""),
                    "website": tags.get("contact:website") or tags.get("website", ""),
                    "opening_hours": tags.get("opening_hours", ""),
                    "latitude": lat,
                    "longitude": lon,
                    "source_name": "OpenStreetMap",
                    "source_url": f"https://www.openstreetmap.org/{item.get('type')}/{item.get('id')}",
                    "source_status": "Mapped feature; current operation not established",
                    "verification_status": "Unverified OSM contribution",
                    "notes": "Coordinates are the OSM node or way/relation center; search bbox is approximate"
                })
            return rows
        except Exception as exc:
            last_error = exc
            print(f"OSM endpoint failed; trying fallback if available: {exc}")
    raise RuntimeError(f"Both Overpass endpoints failed: {last_error}")

def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").lower()
    value = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", value)
    value = value.translate(str.maketrans({"أ":"ا", "إ":"ا", "آ":"ا", "ى":"ي", "ة":"ه"}))
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())

def build_match_candidates(names: list[dict[str, Any]], osm_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not names or not osm_rows:
        return []
    choices: dict[str, list[dict[str, Any]]] = {}
    for row in osm_rows:
        choices.setdefault(normalize_name(str(row["name"])), []).append(row)
    keys = list(choices.keys())
    out = []
    for source in names:
        query = normalize_name(str(source["name"]))
        if not query:
            continue
        exact = choices.get(query, [])
        if exact:
            candidates = [(query, 100, row) for row in exact]
        else:
            best = process.extractOne(query, keys, scorer=fuzz.WRatio, score_cutoff=93)
            if not best:
                continue
            key, score, _ = best
            candidates = [(key, score, row) for row in choices[key]]
        for key, score, row in candidates:
            out.append({
                "source_name": source["name"],
                "candidate_name": row["name"],
                "category": row["category"],
                "address": row["address"],
                "phone": row["phone"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "similarity_score": score,
                "match_type": "exact normalized name" if score == 100 else "fuzzy suggestion",
                "osm_url": row["source_url"],
                "decision": "Manual review required; not auto-merged"
            })
    return out

def fetch_city_directory() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Load the pre-extracted, source-traceable Ibb directory snapshot from the repository."""
    p = ROOT / "data/seed/ibb-city-directory-candidates-301.csv"
    if not p.exists():
        raise FileNotFoundError(f"Cached city directory file is missing: {p}")
    rows: list[dict[str, Any]] = []
    with p.open("r", encoding="utf-8-sig", newline="") as f:
        for i, source in enumerate(csv.DictReader(f), start=1):
            name = (source.get("name") or "").strip()
            if not name:
                continue
            plus_code = (source.get("plus_code") or "").strip().upper()
            lat = lon = ""
            coordinate_method = source.get("coordinate_status") or ""
            if plus_code:
                try:
                    if len(plus_code.split("+", 1)[0]) >= 8:
                        area = olc.decode(plus_code)
                        coordinate_method = "Full Plus Code decoded from source"
                    else:
                        full = olc.recoverNearest(plus_code, IBB_LAT, IBB_LON)
                        area = olc.decode(full)
                        coordinate_method = "Short Plus Code recovered near approximate Ibb center; approximate only"
                    lat, lon = area.latitudeCenter, area.longitudeCenter
                except Exception:
                    coordinate_method = "Plus Code present but could not be decoded"
            source_pages = source.get("source_pages") or source.get("source_page") or ""
            rows.append({
                "record_id": f"ibb-directory-{i:04d}",
                "record_type": "city_directory_listing",
                "name": name,
                "category": source.get("category") or "",
                "address": source.get("address") or "",
                "phone": source.get("phone") or "",
                "website": source.get("website") or "",
                "rating": source.get("rating") or "",
                "review_count": source.get("review_count") or "",
                "plus_code": plus_code,
                "latitude": lat,
                "longitude": lon,
                "source_name": "اليمن.com — دليل أعمال إب",
                "source_url": source_pages,
                "source_status": "Source-visible business card; Ibb locality tag retained; obvious overseas records excluded",
                "verification_status": "Public directory lead; not independently field-verified",
                "notes": "Deduplicated by Google Maps CID where available; source fields retained. " + coordinate_method,
                "google_maps_url": source.get("google_maps_url") or "",
                "social_url": source.get("social_url") or "",
                "location_confidence": "Ibb locality tag in source page; business operation and address require verification",
                "coordinate_method": coordinate_method,
            })
    plus_count = sum(bool(r["plus_code"]) for r in rows)
    coords_count = sum(bool(r["latitude"]) and bool(r["longitude"]) for r in rows)
    stats = {
        "city_directory_page_url": "https://xn--mgb2ddes.com/directory/city/%D8%A5%D8%A8",
        "city_directory_cards_parsed": 240,
        "city_directory_total_claimed_by_source": 471,
        "city_directory_visible_claimed_by_source": 240,
        "city_directory_source_rows_before_dedupe": 528,
        "city_directory_duplicates_removed": 227,
        "city_directory_excluded_clear_nonlocal": 31,
        "city_directory_record_count": len(rows),
        "city_directory_record_count_with_phone": sum(bool(r["phone"]) for r in rows),
        "city_directory_record_count_with_maps_url": sum(bool(r["google_maps_url"]) for r in rows),
        "city_directory_record_count_with_plus_code": plus_count,
        "city_directory_record_count_with_coordinates": coords_count,
        "city_directory_category_counts_claimed": {
            "restaurants_and_cafes": 102, "retail": 92, "healthcare": 94,
            "services": 37, "entertainment_and_landmarks": 40, "education": 35,
            "finance_and_business": 66, "hotels": 5
        },
        "city_directory_category_source_rows": {
            "city": 227, "restaurant": 49, "retail": 43, "healthcare": 53,
            "services": 37, "entertainment": 35, "education": 32, "finance": 47, "hotel": 5
        },
        "city_directory_note": "The city page claims 471 listings but renders only 240. Category pages plus the city page yielded 528 appearances and 301 unique records after deduplication. Public leads, not a verified census."
    }
    return rows, stats

def extract_scrapegraph() -> list[dict[str, Any]]:
    if os.getenv("SCRAPEGRAPH_SKIP", "").strip() == "1":
        print("ScrapeGraphAI: skipped for this run (Gemini provider quota exhausted; cached public-directory records are used).")
        return []
    api_key = os.getenv("SCRAPEGRAPH_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("ScrapeGraphAI: skipped (SCRAPEGRAPH_API_KEY is not configured).")
        return []
    try:
        from scrapegraphai.graphs import SmartScraperMultiGraph
    except Exception as exc:
        print(f"ScrapeGraphAI import failed: {exc}")
        return []
    sources = [
        "https://xn--mgb2ddes.com/directory/city/%D8%A5%D8%A8",
        "https://xn--mgb2ddes.com/directory/restaurant",
        "https://xn--mgb2ddes.com/directory/retail",
        "https://xn--mgb2ddes.com/directory/healthcare",
        "https://xn--mgb2ddes.com/directory/services",
        "https://xn--mgb2ddes.com/directory/entertainment",
        "https://xn--mgb2ddes.com/directory/education",
        "https://xn--mgb2ddes.com/directory/finance",
        "https://xn--mgb2ddes.com/directory/hotel",
    ]
    prompt = (
        "Extract only establishment records visibly present in these source pages and explicitly located "
        "in Ibb, Yemen. Return an object with a businesses array. Each item may contain name, category, "
        "address, phone, website, opening_hours, rating, review_count, plus_code and detail_url. "
        "Do not invent, infer or complete missing fields. Use empty strings/null for absent values. "
        "Exclude other cities, landmarks without a business activity, navigation links and ads. "
        "Preserve Arabic names exactly as displayed."
    )
    config = {
        "llm": {
            "api_key": api_key,
            "model": os.getenv("SCRAPEGRAPH_MODEL", "openai/gpt-4o-mini"),
            "temperature": 0
        },
        "verbose": False,
        "headless": True
    }
    try:
        graph = SmartScraperMultiGraph(prompt=prompt, source=sources, schema=None, config=config)
        result = graph.run()
    except Exception as exc:
        print(f"ScrapeGraphAI run failed: {exc}")
        return []

    def find_businesses(obj: Any) -> list[dict[str, Any]]:
        if isinstance(obj, list):
            found = []
            for item in obj:
                found.extend(find_businesses(item))
            return found
        if isinstance(obj, dict):
            for key, value in obj.items():
                if str(key).lower() in {"businesses", "establishments", "results", "records"} and isinstance(value, list):
                    return [x for x in value if isinstance(x, dict)]
            found = []
            for value in obj.values():
                found.extend(find_businesses(value))
            return found
        return []

    records = find_businesses(result)
    clean = []
    for i, row in enumerate(records, start=1):
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        plus_code = str(row.get("plus_code") or "")
        lat = lon = ""
        if plus_code and PLUS_RE.search(plus_code):
            try:
                full = olc.recoverNearest(PLUS_RE.search(plus_code).group(0), IBB_LAT, IBB_LON)
                area = olc.decode(full)
                lat, lon = area.latitudeCenter, area.longitudeCenter
            except Exception:
                pass
        clean.append({
            "record_id": f"scrapegraph-{i:04d}",
            "record_type": "scrapegraph_extracted",
            "name": name,
            "category": row.get("category") or "",
            "address": row.get("address") or "",
            "phone": row.get("phone") or "",
            "website": row.get("website") or "",
            "opening_hours": row.get("opening_hours") or "",
            "rating": row.get("rating") or "",
            "review_count": row.get("review_count") or "",
            "plus_code": plus_code,
            "latitude": lat,
            "longitude": lon,
            "source_name": "Public web directory via ScrapeGraphAI",
            "source_url": str(row.get("detail_url") or " | ".join(sources)),
            "source_status": "Extracted from visible public page; status not independently verified",
            "verification_status": "Requires source and field verification",
            "notes": "LLM extraction from public directory pages; confirm detail_url and every important field before production use"
        })
    return clean

def main() -> int:
    print("Loading the existing 11,060-name source list...")
    names = load_source_names()
    print(f"Source names: {len(names)}")
    print("Loading the sourced 270-record public-directory seed...")
    seed = load_seed()
    print(f"Seed records: {len(seed)}; with decoded Plus Code coordinates: {sum(bool(x['latitude']) for x in seed)}")
    print("Querying OpenStreetMap / Overpass...")
    try:
        osm = fetch_osm()
    except Exception as exc:
        print(f"OSM query failed; continuing with sourced seed only: {exc}")
        osm = []
    print(f"OSM named business features: {len(osm)}")
    city_rows, city_stats = ([], {})
    try:
        print("Parsing the city-filtered Ibb public business directory...")
        city_rows, city_stats = fetch_city_directory()
        print(f"City directory visible records after conservative filtering: {len(city_rows)}")
    except Exception as exc:
        print(f"City directory parse failed; continuing with other sources: {exc}")
    scraped = extract_scrapegraph()
    print(f"ScrapeGraphAI extracted candidates: {len(scraped)}")
    candidates = build_match_candidates(names, osm)
    combined = names + seed + osm + city_rows + scraped

    write_csv(OUT / "ibb_source_names_11060.csv", names)
    write_csv(OUT / "ibb_public_directory_seed.csv", seed)
    write_csv(OUT / "ibb_osm_businesses.csv", osm)
    write_csv(OUT / "ibb_city_directory_visible.csv", city_rows)
    write_csv(OUT / "ibb_scrapegraph_candidates.csv", scraped)
    write_csv(OUT / "ibb_all_sources_full.csv", combined)
    write_csv(
        OUT / "ibb_name_match_candidates.csv", candidates,
        ["source_name", "candidate_name", "category", "address", "phone", "latitude",
         "longitude", "similarity_score", "match_type", "osm_url", "decision"]
    )

    summary = {
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_name_count": len(names),
        "public_directory_seed_count": len(seed),
        "seed_with_plus_code_coordinates": sum(bool(x["latitude"]) for x in seed),
        "osm_business_feature_count": len(osm),
        **city_stats,
        "scrapegraph_candidate_count": len(scraped),
        "name_match_candidate_count": len(candidates),
        "combined_row_count": len(combined),
        "search_bbox_south_west_north_east": list(BBOX),
        "boundary_warning": "The bounding box is approximate and is not an official Ibb city/municipal boundary.",
        "verification_warning": "Public directory, OSM and AI-extracted rows are leads, not proof that a business is open or independently verified.",
        "excluded_input": "ibb_city_all_9000_establishments.csv was excluded after structural checks showed synthetic repeated names/coordinates.",
        "scrapegraph_status": "skipped_provider_quota_limit" if os.getenv("SCRAPEGRAPH_SKIP", "").strip() == "1" else ("enabled" if os.getenv("SCRAPEGRAPH_API_KEY") or os.getenv("OPENAI_API_KEY") else "skipped_no_api_key"),
        "drive_upload": "handled by the separate optional workflow step"
    }
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    readme = (
        "# Ibb directory export\n\n"
        "This export intentionally separates source-only names, sourced public directory rows, "
        "OpenStreetMap features, ScrapeGraphAI candidates and manual-review matches.\n\n"
        "- ibb_source_names_11060.csv: all names imported from the IBB repository; no extra facts are inferred.\n"
        "- ibb_public_directory_seed.csv: 270 records from a public-directory workbook; source status is retained. "
        "Short Plus Codes are decoded using an approximate Ibb center, so coordinates must be checked.\n"
        "- ibb_osm_businesses.csv: named business-tagged OpenStreetMap features inside an approximate bounding box.\n"
        "- ibb_city_directory_visible.csv: 301 unique Ibb directory leads merged from the city page and eight category pages after deduplication; the city page itself renders only 240 of 471 source-claimed listings.\n"
        "- ibb_scrapegraph_candidates.csv: AI-extracted candidates from public pages, only when an LLM API key is configured.\n"
        "- ibb_name_match_candidates.csv: potential name-to-OSM matches, never auto-merged.\n"
        "- ibb_all_sources_full.csv: row-wise combined export with source and verification fields.\n\n"
        "Do not label this as a complete verified census. Coverage depends on public-source coverage and OSM mapping. "
        "Names-only rows have no coordinates. The approximate collection bounding box is not an administrative boundary. "
        "The previously found 9,000-row CSV with synthetic patterns is excluded.\n"
    )
    (OUT / "README.txt").write_text(readme, encoding="utf-8")
    zip_path = OUT / "ibb_directory_export.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(OUT.iterdir()):
            if path.is_file() and path.name != zip_path.name:
                z.write(path, arcname=path.name)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FATAL: {error}", file=sys.stderr)
        raise

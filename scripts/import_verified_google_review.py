#!/usr/bin/env python3
"""Import the user-reviewed Google Search/Maps CSV into IBB's traceable profile shards."""
from __future__ import annotations
import argparse, csv, json, sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {
    "record_number", "record_id", "original_name", "name", "record_group",
    "review_status", "verification_status_ar", "verified_category",
    "verified_street_district", "verified_landmark", "verified_address_plus_code",
    "verified_phone", "verified_rating", "verified_reviews_count", "verified_place_id",
    "verified_external_url", "google_maps_search_url", "review_notes",
}

def norm(value: str) -> str:
    import unicodedata
    return " ".join(unicodedata.normalize("NFKC", value or "").split())

def read_source_names() -> list[str]:
    index = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
    result: list[str] = []
    for filename in index["chunks"]:
        values = json.loads((ROOT / "data" / filename).read_text(encoding="utf-8"))
        if not isinstance(values, list) or any(not isinstance(x, str) or not x.strip() for x in values):
            raise ValueError(f"Invalid source-name chunk: {filename}")
        result.extend(values)
    if len(result) != int(index["totalRecords"]):
        raise ValueError("The base name dataset count does not match data/index.json")
    return result

def safe_url(value: str, column: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise ValueError(f"Invalid HTTP(S) URL in {column}: {value!r}")
    return value

def convert(csv_path: Path, out_dir: Path, chunk_size: int = 500) -> dict:
    source_names = read_source_names()
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED - set(reader.fieldnames or [])
        if missing:
            raise ValueError("Missing CSV columns: " + ", ".join(sorted(missing)))
        records, ids, source_seen = [], set(), set()
        place_counts, states = Counter(), Counter()
        for row_number, raw in enumerate(reader, 1):
            number = int((raw.get("record_number") or "0").strip())
            if number != row_number or number > len(source_names):
                raise ValueError(f"record_number sequence error at CSV row {row_number}")
            source_name = (raw.get("original_name") or "").strip()
            verified_name = (raw.get("name") or "").strip()
            record_id = (raw.get("record_id") or "").strip()
            if norm(source_name) != norm(source_names[number - 1]):
                raise ValueError(f"CSV source name does not match IBB base row {number}")
            if not source_name or not verified_name or not record_id:
                raise ValueError(f"Blank key/name at row {number}")
            if record_id in ids or source_name in source_seen:
                raise ValueError(f"Duplicate record_id/source_name at row {number}")
            ids.add(record_id); source_seen.add(source_name)
            state = (raw.get("review_status") or "").strip()
            states[state] += 1
            if state != "match":
                raise ValueError(f"Row {number} is not marked match; refusing partial/unchecked import")
            place_id = (raw.get("verified_place_id") or "").strip()
            if place_id:
                place_counts[place_id] += 1
            records.append({
                "record_number": number,
                "record_id": record_id,
                "source_name": source_name,
                "verified_name": verified_name,
                "record_group": (raw.get("record_group") or "").strip(),
                "review_status": state,
                "verification_status": (raw.get("verification_status_ar") or "").strip(),
                "category": (raw.get("verified_category") or "").strip(),
                "district": (raw.get("verified_street_district") or "").strip(),
                "landmark": (raw.get("verified_landmark") or "").strip(),
                "address_plus_code": (raw.get("verified_address_plus_code") or "").strip(),
                "phone": (raw.get("verified_phone") or "").strip(),
                # Preserve source text exactly; some ratings contain more than one value.
                "rating": (raw.get("verified_rating") or "").strip(),
                "reviews_count": (raw.get("verified_reviews_count") or "").strip(),
                "place_id": place_id,
                "external_url": safe_url(raw.get("verified_external_url", ""), "verified_external_url"),
                "maps_search_url": safe_url(raw.get("google_maps_search_url", ""), "google_maps_search_url"),
                "review_notes": (raw.get("review_notes") or "").strip(),
            })
    if len(records) != len(source_names):
        raise ValueError(f"Expected {len(source_names)} CSV records, found {len(records)}")
    if states != Counter({"match": len(source_names)}):
        raise ValueError("The complete source file must have match status on every row")

    out_dir.mkdir(parents=True, exist_ok=True)
    chunks = []
    for offset in range(0, len(records), chunk_size):
        filename = f"verified-profiles-{offset // chunk_size + 1:03d}.json"
        target = out_dir / filename
        target.write_text(
            json.dumps(records[offset:offset + chunk_size], ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        chunks.append(filename)

    verified_names = Counter(x["verified_name"] for x in records)
    summary = {
        "totalRecords": len(records),
        "uniqueRecordIds": len(ids),
        "uniqueSourceNames": len(source_seen),
        "uniqueVerifiedNames": len(verified_names),
        "duplicateVerifiedNameRows": len(records) - len(verified_names),
        "uniquePlaceIds": len(place_counts),
        "duplicatePlaceIdRows": sum(n - 1 for n in place_counts.values() if n > 1),
        "missingPlaceIdRecords": sum(not x["place_id"] for x in records),
        "missingPhoneRecords": sum(not x["phone"] for x in records),
        "missingRatingRecords": sum(not x["rating"] for x in records),
        "missingReviewCountRecords": sum(not x["reviews_count"] for x in records),
        "reviewStates": dict(states),
        "coordinatesImported": False,
        "placeIdIsUnique": False,
    }
    index = {
        "schemaVersion": 1,
        "sourceFile": csv_path.name,
        "sourceDescription": "User-reviewed Ibb Google Search/Maps CSV",
        "recordKey": "record_id",
        "sourceOrderField": "record_number",
        "sourceNameField": "source_name",
        "verifiedNameField": "verified_name",
        "totalRecords": len(records),
        "chunkSize": chunk_size,
        "chunks": chunks,
        "reviewStatusRequired": "match",
        "coordinatesImported": False,
        "placeIdIsUnique": False,
        "notes": [
            "All source rows are preserved in original order; no automatic deduplication.",
            "Place IDs are references, not primary keys; repeated Place IDs are allowed.",
            "Text addresses and Plus Codes are not converted into latitude/longitude.",
            "A reviewed match does not certify current opening status, ownership, stock, or prices.",
        ],
    }
    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "import-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "README.txt").write_text(
        "IBB reviewed directory profiles\n"
        f"Records: {len(records)}\n"
        "record_id is the record key. Place IDs may repeat. There are no GPS coordinates in the input.\n"
        "A reviewed record is not proof of live business status, legal ownership, or current inventory/pricing.\n",
        encoding="utf-8",
    )
    return summary

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path, help="Path to google_search_review_all.csv")
    parser.add_argument("--out", type=Path, default=ROOT / "data/verified-profiles")
    parser.add_argument("--chunk-size", type=int, default=500)
    args = parser.parse_args()
    if not 100 <= args.chunk_size <= 1000:
        raise ValueError("--chunk-size must be between 100 and 1000")
    result = convert(args.csv_path, args.out, args.chunk_size)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"IMPORT_FAILED: {exc}", file=sys.stderr)
        raise

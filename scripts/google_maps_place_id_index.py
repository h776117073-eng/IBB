#!/usr/bin/env python3
"""Resolve Google Places IDs for Ibb source records without exporting Places content.

The API field mask is deliberately limited to places.id. Place IDs are the
only Google-derived values persisted by this tool. Business names, addresses,
phones, ratings, coordinates, hours, reviews and other Places Content are
neither requested nor stored. Source fields are query text only.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "data/index.json"
DEFAULT_CSV = ROOT / "data/input/ibb_city_all_9000_establishments_enriched_verified.csv"
OUT_DIR = ROOT / "verification"
RESULTS_FILE = OUT_DIR / "google_maps_place_ids.csv"
PROGRESS_FILE = OUT_DIR / "google_maps_place_ids_progress.json"
API_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = "places.id"
CITY_CENTER = (13.96667, 44.18333)
CITY_RADIUS_M = 20000.0
DEFAULT_BATCH_SIZE = 1000
MAX_BATCH_SIZE = 2000
REQUEST_INTERVAL_SECONDS = 0.25
RESULT_FIELDS = [
    "record_id", "source_name", "search_status", "candidate_count",
    "google_place_ids", "maps_urls", "checked_at_utc"
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as tmp:
        json.dump(value, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def normalize_coords(value: Any) -> float | None:
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if -180 <= parsed <= 180 else None


def first_value(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def record_from_csv(row: dict[str, Any], index: int) -> dict[str, Any] | None:
    name = first_value(row, "Name_AR", "name", "Name", "الاسم", "اسم المنشأة", "اسم المنشأة أو المعلم")
    if not name:
        return None
    address = first_value(row, "Full_Address", "Verified_Address", "address", "العنوان")
    district = first_value(row, "District", "district", "المديرية", "المنطقة")
    query_parts = [name]
    if address:
        query_parts.append(address)
    elif district:
        query_parts.append(district)
    query_parts.append("Ibb Yemen")
    return {
        "record_id": f"csv-row-{index:06d}",
        "source_name": name,
        "text_query": " ".join(part for part in query_parts if part),
        "latitude": normalize_coords(first_value(row, "Latitude", "latitude", "lat")),
        "longitude": normalize_coords(first_value(row, "Longitude", "longitude", "lng", "lon")),
    }


def load_csv_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"CSV has no header row: {path}")
        for index, row in enumerate(reader, start=1):
            record = record_from_csv(row, index)
            if record:
                records.append(record)
    if not records:
        raise ValueError(f"No non-empty establishment names found in {path}")
    return records


def load_repository_names() -> list[dict[str, Any]]:
    if not INDEX.exists():
        raise FileNotFoundError(f"Repository source index missing: {INDEX}")
    index_data = json.loads(INDEX.read_text(encoding="utf-8"))
    records: list[dict[str, Any]] = []
    for chunk_name in index_data.get("chunks", []):
        chunk_path = ROOT / "data" / chunk_name
        values = json.loads(chunk_path.read_text(encoding="utf-8"))
        if not isinstance(values, list):
            raise ValueError(f"Unexpected JSON structure in {chunk_path}")
        for name in values:
            if isinstance(name, str) and name.strip():
                n = name.strip()
                records.append({
                    "record_id": f"source-name-{len(records)+1:05d}",
                    "source_name": n,
                    "text_query": f"{n} Ibb Yemen",
                    "latitude": None,
                    "longitude": None,
                })
    expected = int(index_data.get("totalRecords", len(records)))
    if len(records) != expected:
        raise ValueError(f"Source count mismatch: expected {expected}, loaded {len(records)}")
    return records


def load_records(source_path: str) -> tuple[list[dict[str, Any]], str, str]:
    if source_path == "auto":
        if DEFAULT_CSV.exists():
            path = DEFAULT_CSV
        else:
            records = load_repository_names()
            source_hash = hashlib.sha256(
                "\n".join(r["source_name"] for r in records).encode("utf-8")
            ).hexdigest()
            return records, "repository_names_11060", source_hash
    else:
        path = Path(source_path)
        if not path.is_absolute():
            path = ROOT / path
    if not path.exists():
        raise FileNotFoundError(f"Input CSV not found: {path}")
    records = load_csv_records(path)
    label = str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path)
    return records, label, sha256_file(path)


def request_body(record: dict[str, Any]) -> dict[str, Any]:
    lat = record.get("latitude")
    lon = record.get("longitude")
    if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
        center_lat, center_lon, radius = lat, lon, 750.0
    else:
        center_lat, center_lon, radius = CITY_CENTER[0], CITY_CENTER[1], CITY_RADIUS_M
    return {
        "textQuery": record["text_query"],
        "pageSize": 5,
        "languageCode": "ar",
        "regionCode": "YE",
        "locationBias": {
            "circle": {
                "center": {"latitude": center_lat, "longitude": center_lon},
                "radius": radius,
            }
        },
    }


def parse_place_ids(payload: dict[str, Any]) -> list[str]:
    places = payload.get("places", [])
    if not isinstance(places, list):
        raise ValueError("Unexpected Places API response: 'places' must be a list")
    ids: list[str] = []
    for place in places:
        if isinstance(place, dict):
            place_id = place.get("id")
            if isinstance(place_id, str) and place_id.strip():
                ids.append(place_id.strip())
    return list(dict.fromkeys(ids))


def maps_url(name: str, place_id: str) -> str:
    query = urllib.parse.quote_plus(name)
    pid = urllib.parse.quote_plus(place_id)
    return f"https://www.google.com/maps/search/?api=1&query={query}&query_place_id={pid}"


def call_places_api(api_key: str, record: dict[str, Any], timeout: int = 25) -> list[str]:
    data = json.dumps(request_body(record), ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": FIELD_MASK,
            "User-Agent": "IBB-Market-PlaceIdLinker/1.0",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return parse_place_ids(payload)
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")[:1000]
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise RuntimeError(f"Places API HTTP {error.code}: {body}") from error
            last_error = error
            retry_after = error.headers.get("Retry-After", "")
            try:
                delay = min(60.0, max(1.0, float(retry_after)))
            except ValueError:
                delay = min(30.0, 2.0 ** attempt)
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            if attempt == 4:
                raise RuntimeError(f"Places API transport/JSON failure: {error}") from error
            last_error = error
            time.sleep(min(30.0, 2.0 ** attempt))
    raise RuntimeError(f"Places API request failed after retries: {last_error}")


def load_done_record_ids(path: Path) -> set[str]:
    done: set[str] = set()
    if not path.exists():
        return done
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != RESULT_FIELDS:
            raise RuntimeError(
                f"Unexpected result file columns in {path}; move it aside before starting again."
            )
        for row in reader:
            record_id = (row.get("record_id") or "").strip()
            if record_id:
                done.add(record_id)
    return done


def append_result(path: Path, record: dict[str, Any], place_ids: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_exists = path.exists() and path.stat().st_size > 0
    with path.open("a", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=RESULT_FIELDS)
        if not file_exists:
            writer.writeheader()
        writer.writerow({
            "record_id": record["record_id"],
            "source_name": record["source_name"],
            "search_status": "candidate_place_id_found" if place_ids else "no_place_id_returned",
            "candidate_count": len(place_ids),
            "google_place_ids": "|".join(place_ids),
            "maps_urls": "|".join(maps_url(record["source_name"], pid) for pid in place_ids),
            "checked_at_utc": utc_now(),
        })
        handle.flush()
        os.fsync(handle.fileno())


def save_progress(input_hash: str, source_label: str, next_index: int, total: int) -> None:
    atomic_json(PROGRESS_FILE, {
        "source_label": source_label,
        "input_sha256": input_hash,
        "next_index": next_index,
        "total_records": total,
        "complete": next_index >= total,
        "updated_utc": utc_now(),
        "google_data_persisted": "Place IDs only",
    })


def self_test() -> None:
    fake = {
        "places": [
            {"id": "ChIJtestPlace123", "displayName": {"text": "MUST_NOT_BE_SAVED"},
             "formattedAddress": "MUST_NOT_BE_SAVED"},
            {"id": "ChIJtestPlace456"},
            {"id": "ChIJtestPlace123"},
            {"displayName": {"text": "NO_ID"}},
        ]
    }
    ids = parse_place_ids(fake)
    assert ids == ["ChIJtestPlace123", "ChIJtestPlace456"], ids
    assert parse_place_ids({"places": []}) == []
    rec = {"text_query": "مستشفى النصر إب اليمن", "latitude": 13.965, "longitude": 44.172}
    body = request_body(rec)
    assert body["pageSize"] == 5
    assert body["locationBias"]["circle"]["radius"] == 750.0
    assert maps_url("مستشفى النصر", ids[0]).startswith("https://www.google.com/maps/search/?api=1&query=")
    print("SELF_TEST_OK: ID-only parsing, no-result handling, deduplication, location bias and Maps URL generation")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-path", default="auto")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--validate-source", action="store_true")
    args = parser.parse_args()

    if args.batch_size < 1 or args.batch_size > MAX_BATCH_SIZE:
        raise ValueError(f"batch-size must be between 1 and {MAX_BATCH_SIZE}")
    if args.self_test:
        self_test()
    if not args.validate_source and args.self_test:
        return 0

    records, source_label, input_hash = load_records(args.source_path)
    print(f"SOURCE_VALID: {source_label}; records={len(records)}; sha256={input_hash[:16]}")
    if args.validate_source:
        return 0

    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY is not configured. Add it in GitHub Actions repository secrets.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    progress: dict[str, Any] = {}
    if PROGRESS_FILE.exists() and not args.reset:
        progress = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        if progress.get("input_sha256") != input_hash:
            raise RuntimeError("Input changed. Run workflow_dispatch with reset=true to start a clean index.")
    if args.reset:
        PROGRESS_FILE.unlink(missing_ok=True)
        RESULTS_FILE.unlink(missing_ok=True)
        progress = {}

    next_index = int(progress.get("next_index", 0))
    if next_index >= len(records):
        print("SCAN_COMPLETE: all source records already have a completed search pass.")
        return 0

    end_index = min(len(records), next_index + args.batch_size)
    done_record_ids = load_done_record_ids(RESULTS_FILE)
    for index in range(next_index, end_index):
        record = records[index]
        if record["record_id"] not in done_record_ids:
            place_ids = call_places_api(api_key, record)
            append_result(RESULTS_FILE, record, place_ids)
            done_record_ids.add(record["record_id"])
        next_index = index + 1
        save_progress(input_hash, source_label, next_index, len(records))
        if next_index < end_index:
            time.sleep(REQUEST_INTERVAL_SECONDS)
    print(f"BATCH_COMPLETE: processed_index={next_index}/{len(records)}; complete={next_index >= len(records)}")
    print("RESULT_LEDGER: one row per searched source record, including no-result rows.")
    print("PERSISTED_GOOGLE_FIELDS: Place IDs only; Maps links are constructed from source names and Place IDs.")
    print("NOT_PERSISTED: Google place names, addresses, phones, ratings, hours, coordinates, reviews or other Google Maps Content.")
    print("NOTE: no Place ID returned is not proof that a business does not exist.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise

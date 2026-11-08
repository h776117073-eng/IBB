#!/usr/bin/env python3
"""Safely prepare or import the 7,015-row Google Maps archive into IBB D1.

Default mode is dry-run. Live writes require --apply, --confirm-count 7015,
and IBB_IMPORT_API_KEY. The destination endpoint is insert-only and skips
existing conflicts, so rerunning after interruption is safe.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from decode_staged_google_maps_shards import decode

EXPECTED_RECORDS = 7015
EXPECTED_RAW_RECORDS = 16441
EXPECTED_SHARDS = 71
EXPECTED_SOURCE = "GOOGLE_MAPS_ARCHIVE_WORKBOOK"
EXPECTED_WORKBOOK = "السجل الجديد المتحقق منه عبر خرائط جوجل.xlsx"
EXPECTED_SOURCE_STATUS = "ARCHIVE_EXTRACTED_NOT_INDEPENDENTLY_REVIEWED"
DEFAULT_API_BASE = "https://ibb-market-api.aicreativestudio.workers.dev"
IMPORT_PATH = "/api/v1/admin/directory/archive-import"


def validate_manifest(manifest: dict) -> None:
    required = {
        "uniqueSheetRecords": EXPECTED_RECORDS,
        "rawSheetRecordsAuditedButNotExported": EXPECTED_RAW_RECORDS,
        "rawSheetRecordsImported": 0,
        "uniquePlaceIds": EXPECTED_RECORDS,
        "recordsPublished": 0,
        "verificationStatus": "UNVERIFIED",
        "visibilityStatus": "NEEDS_REVIEW",
        "sourceWorkbook": EXPECTED_WORKBOOK,
    }
    for key, expected in required.items():
        if manifest.get(key) != expected:
            raise ValueError(f"Unsafe or unexpected manifest value: {key}")
    chunks = manifest.get("chunks")
    if not isinstance(chunks, list) or len(chunks) != EXPECTED_SHARDS:
        raise ValueError(f"Expected exactly {EXPECTED_SHARDS} staged shards")
    if manifest.get("sourceWorkbook") != EXPECTED_WORKBOOK:
        raise ValueError("Manifest workbook is not the allowlisted source file")


def validate_candidate(row: dict) -> int:
    if not isinstance(row, dict):
        raise ValueError("Candidate row must be an object")
    match = re.fullmatch(r"unique-sheet-row-(\d+)", str(row.get("source_record_id", "")))
    if not match:
        raise ValueError("Invalid source_record_id")
    sequence = int(match.group(1))
    if not 1 <= sequence <= EXPECTED_RECORDS:
        raise ValueError("Source row number is outside the 7,015-row allowlist")

    place_id = str(row.get("place_id", ""))
    if not re.fullmatch(r"ChI[A-Za-z0-9_-]{10,}", place_id):
        raise ValueError("Missing or invalid Google Place ID")
    expected_id = "gmaps-" + hashlib.sha256(place_id.encode("utf-8")).hexdigest()[:24]
    if row.get("id") != expected_id:
        raise ValueError("Candidate ID does not match its Place ID")
    if not re.fullmatch(r"[a-f0-9]{64}", str(row.get("source_hash", ""))):
        raise ValueError("Invalid source hash")
    if row.get("source_file") != EXPECTED_WORKBOOK or not str(row.get("name", "")).strip():
        raise ValueError("Candidate source file is not the allowlisted workbook")

    fixed = {
        "source_name": EXPECTED_SOURCE,
        "source_status": EXPECTED_SOURCE_STATUS,
        "kind": "BUSINESS",
        "operational_status": "UNKNOWN",
        "geometry_type": "POINT",
        "identity_status": "UNVERIFIED",
        "verification_status": "UNVERIFIED",
        "visibility_status": "NEEDS_REVIEW",
    }
    for key, expected in fixed.items():
        if row.get(key) != expected:
            raise ValueError(f"Unsafe candidate field: {key}")
    if row.get("is_public") not in (0, False):
        raise ValueError("Candidate must remain non-public")
    if row.get("is_commercial") not in (1, True):
        raise ValueError("Candidate must be marked as a commercial place")

    lat, lon = row.get("latitude"), row.get("longitude")
    location_status = row.get("location_status")
    precision = row.get("location_precision")
    if location_status == "MISSING":
        if precision != "MISSING" or lat is not None or lon is not None:
            raise ValueError("Missing-coordinate rows must have null coordinates")
    elif location_status == "APPROXIMATE":
        if precision != "APPROXIMATE":
            raise ValueError("Approximate coordinates require APPROXIMATE precision")
        if isinstance(lat, bool) or isinstance(lon, bool):
            raise ValueError("Boolean coordinates are invalid")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            raise ValueError("Approximate coordinates are required")
        if not math.isfinite(float(lat)) or not math.isfinite(float(lon)):
            raise ValueError("Coordinates must be finite")
        if not (13.7 <= float(lat) <= 14.3 and 43.7 <= float(lon) <= 44.5):
            raise ValueError("Approximate coordinates are outside the staging bounds")
    else:
        raise ValueError("Candidate has an unsupported location status")
    return sequence


def load_candidates(source: Path) -> tuple[dict, list[dict]]:
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    validate_manifest(manifest)
    with tempfile.TemporaryDirectory(prefix="ibb-archive-import-") as temp_dir:
        summary = decode(source, Path(temp_dir))
        if summary.get("records") != EXPECTED_RECORDS or summary.get("shards") != EXPECTED_SHARDS:
            raise ValueError("The staged archive did not pass the complete shard audit")
        rows: list[dict] = []
        for path in sorted(Path(temp_dir).glob("maps-candidates-*.json")):
            shard = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(shard, list):
                raise ValueError(f"Invalid decoded shard: {path.name}")
            rows.extend(shard)

    if len(rows) != EXPECTED_RECORDS:
        raise ValueError(f"Expected {EXPECTED_RECORDS} rows, found {len(rows)}")
    observed_source_files = sorted({str(row.get("source_file", "")) for row in rows})
    if observed_source_files != [EXPECTED_WORKBOOK]:
        raise ValueError(
            f"Staged row source_file values do not match allowlisted workbook: "
            f"observed={observed_source_files!r}, expected={EXPECTED_WORKBOOK!r}"
        )
    sequences: set[int] = set()
    ids: set[str] = set()
    place_ids: set[str] = set()
    source_files: set[str] = set()
    for row in rows:
        sequence = validate_candidate(row)
        if sequence in sequences:
            raise ValueError(f"Duplicate source row number: {sequence}")
        if row["id"] in ids:
            raise ValueError(f"Duplicate candidate ID: {row['id']}")
        if row["place_id"] in place_ids:
            raise ValueError(f"Duplicate Place ID: {row['place_id']}")
        sequences.add(sequence)
        ids.add(row["id"])
        place_ids.add(row["place_id"])
        source_files.add(row["source_file"])

    if sequences != set(range(1, EXPECTED_RECORDS + 1)):
        raise ValueError("The staged source row sequence is incomplete")
    if len(place_ids) != EXPECTED_RECORDS or len(source_files) != 1:
        raise ValueError("Place ID uniqueness or single-source-file check failed")
    return manifest, rows


def api_base() -> str:
    value = os.environ.get("IBB_IMPORT_API_URL", DEFAULT_API_BASE).rstrip("/")
    parsed = urllib.parse.urlparse(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "ibb-market-api.aicreativestudio.workers.dev"
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("IBB_IMPORT_API_URL must use the approved IBB Worker host")
    return value


def post_batches(rows: list[dict], batch_size: int) -> dict:
    key = os.environ.get("IBB_IMPORT_API_KEY", "").strip()
    if not key:
        raise ValueError("IBB_IMPORT_API_KEY is required for --apply")
    url = api_base() + IMPORT_PATH
    inserted = skipped = attempted = 0
    batches = (len(rows) + batch_size - 1) // batch_size

    for index, start in enumerate(range(0, len(rows), batch_size), 1):
        chunk = rows[start:start + batch_size]
        body = json.dumps({"items": chunk}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1000]
            raise RuntimeError(f"Batch {index}/{batches} rejected with HTTP {error.code}: {detail}") from None
        except Exception as error:
            raise RuntimeError(
                f"Batch {index}/{batches} stopped ({type(error).__name__}). "
                "Rerun the same command to resume; existing IDs are insert-only."
            ) from None

        if (
            not result.get("ok")
            or result.get("conflict_policy") != "INSERT_ONLY"
            or result.get("attempted") != len(chunk)
            or not isinstance(result.get("imported"), int)
            or not isinstance(result.get("skipped"), int)
            or result["imported"] + result["skipped"] != len(chunk)
        ):
            raise RuntimeError(f"Batch {index}/{batches} returned an unexpected import result")

        inserted += result["imported"]
        skipped += result["skipped"]
        attempted += len(chunk)
        print(
            json.dumps(
                {"batch": index, "batches": batches, "attempted": len(chunk),
                 "inserted": result["imported"], "skipped": result["skipped"]},
                ensure_ascii=False,
            ),
            flush=True,
        )
        time.sleep(0.15)

    return {"attempted": attempted, "inserted": inserted, "skipped_existing": skipped, "batches": batches}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("data/staging/google-maps-workbook"))
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--apply", action="store_true", help="Perform live D1 writes; dry-run is the default")
    parser.add_argument("--confirm-count", type=int, help="Must be 7015 when --apply is supplied")
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 250:
        parser.error("--batch-size must be between 1 and 250")

    manifest, rows = load_candidates(args.source)
    report = {
        "mode": "LIVE_IMPORT" if args.apply else "DRY_RUN",
        "candidate_records": len(rows),
        "shards": len(manifest["chunks"]),
        "raw_records_audited_only": manifest["rawSheetRecordsAuditedButNotExported"],
        "raw_records_imported": 0,
        "published_records": 0,
        "verification_status": "UNVERIFIED",
        "visibility_status": "NEEDS_REVIEW",
        "batch_size": args.batch_size,
    }
    if not args.apply:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.confirm_count != EXPECTED_RECORDS:
        parser.error("--apply requires --confirm-count 7015")
    report["destination"] = api_base() + IMPORT_PATH
    report["result"] = post_batches(rows, args.batch_size)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ARCHIVE_IMPORT_FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)

#!/usr/bin/env python3
"""Decode the committed gzip+base64 candidate shards and verify their trust state."""
from __future__ import annotations
import argparse, base64, gzip, json
from pathlib import Path

def decode(directory: Path, output: Path) -> dict:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    expected_chunks = manifest.get("chunks", [])
    shards = sorted(directory.glob("maps-candidates-*.json.gz.b64"))
    if len(shards) != len(expected_chunks):
        raise ValueError(f"Expected {len(expected_chunks)} compressed shards, found {len(shards)}")
    output.mkdir(parents=True, exist_ok=True)
    total = 0
    seen = set()
    place_ids = set()
    inside = outside = 0
    for source in shards:
        compressed = base64.b64decode("".join(source.read_text(encoding="ascii").split()), validate=True)
        payload = gzip.decompress(compressed)
        rows = json.loads(payload.decode("utf-8"))
        if not isinstance(rows, list) or len(rows) > 500:
            raise ValueError(f"Invalid shard payload: {source.name}")
        for row in rows:
            if row.get("verification_status") != "UNVERIFIED":
                raise ValueError(f"Unsafe verification state in {source.name}")
            if row.get("visibility_status") != "NEEDS_REVIEW":
                raise ValueError(f"Unsafe visibility state in {source.name}")
            if row.get("identity_status") != "UNVERIFIED":
                raise ValueError(f"Invalid identity state in {source.name}")
            if row.get("location_status") not in {"APPROXIMATE", "MISSING"}:
                raise ValueError(f"Invalid location state in {source.name}")
            if int(row.get("is_public", 0)) != 0:
                raise ValueError(f"Candidate unexpectedly marked public in {source.name}")
            lat, lon = row.get("latitude"), row.get("longitude")
            if row["location_status"] == "MISSING":
                if lat is not None or lon is not None:
                    raise ValueError(f"Out-of-scope coordinates were not quarantined in {source.name}")
                outside += 1
            else:
                if lat is None or lon is None or not (13.7 <= float(lat) <= 14.3 and 43.7 <= float(lon) <= 44.5):
                    raise ValueError(f"Approximate coordinates outside Ibb bbox in {source.name}")
                inside += 1
            if not row.get("place_id") or row["place_id"] in place_ids:
                raise ValueError(f"Missing or duplicate Place ID in {source.name}")
            place_ids.add(row["place_id"])
            if row["id"] in seen:
                raise ValueError(f"Duplicate ID: {row['id']}")
            seen.add(row["id"])
        (output / source.name.removesuffix(".gz.b64")).write_bytes(payload)
        total += len(rows)
    if total != 7015 or total != manifest.get("uniqueSheetRecords"):
        raise ValueError(f"Expected 7,015 candidate rows, decoded {total}")
    if len(place_ids) != manifest.get("uniquePlaceIds"):
        raise ValueError("Unique Place ID count does not match manifest")
    if inside != manifest.get("recordsWithinApproxIbbBbox") or outside != manifest.get("recordsOutsideApproxIbbBboxQuarantinedFromMap"):
        raise ValueError("Coordinate quarantine counts do not match manifest")
    if manifest.get("rawSheetRecordsAuditedButNotExported") != 16441:
        raise ValueError("Raw sheet audit count changed unexpectedly")
    if manifest.get("rawSheetRecordsImported") != 0 or manifest.get("recordsPublished") != 0:
        raise ValueError("Manifest violates raw-data exclusion or no-publication policy")
    return {"shards": len(shards), "records": total, "unique_ids": len(seen), "published": 0}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("data/staging/google-maps-workbook"))
    parser.add_argument("--out", type=Path, default=Path("/tmp/ibb-maps-candidates"))
    args = parser.parse_args()
    print(json.dumps(decode(args.source, args.out), indent=2))

if __name__ == "__main__":
    main()

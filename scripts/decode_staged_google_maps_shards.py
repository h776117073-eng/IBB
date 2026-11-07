#!/usr/bin/env python3
"""Decode the committed gzip+base64 candidate shards and verify their trust state."""
from __future__ import annotations
import argparse, base64, gzip, json
from pathlib import Path

def decode(directory: Path, output: Path) -> dict:
    shards = sorted(directory.glob("maps-candidates-*.json.gz.b64"))
    if len(shards) != 15:
        raise ValueError(f"Expected 15 compressed shards, found {len(shards)}")
    output.mkdir(parents=True, exist_ok=True)
    total = 0
    seen = set()
    for source in shards:
        compressed = base64.b64decode(source.read_text(encoding="ascii"), validate=True)
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
            if row["id"] in seen:
                raise ValueError(f"Duplicate ID: {row['id']}")
            seen.add(row["id"])
        (output / source.name.removesuffix(".gz.b64")).write_bytes(payload)
        total += len(rows)
    if total != 7015:
        raise ValueError(f"Expected 7,015 candidate rows, decoded {total}")
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
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

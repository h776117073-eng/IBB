#!/usr/bin/env python3
"""Build regional PMTiles from the official Overture GeoParquet release.

Only Overture data is used here. Google Maps tiles/imagery are deliberately
excluded: this pipeline must not ingest, cache, or redistribute Google content.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import duckdb

# Governorate-wide envelope; use bbox intersection rather than centroid-only
# filtering so long roads and boundary features crossing the envelope survive.
WEST, SOUTH, EAST, NORTH = 43.651662, 13.704949, 44.681488, 14.465592
BBOX_SQL = (
    f"bbox.xmin <= {EAST} AND bbox.xmax >= {WEST} "
    f"AND bbox.ymin <= {NORTH} AND bbox.ymax >= {SOUTH}"
)
RELEASE = os.environ["OVERTURE_RELEASE"]
OUT = Path("build/pmtiles")
OUT.mkdir(parents=True, exist_ok=True)

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
con.execute("INSTALL spatial; LOAD spatial;")
con.execute("SET s3_region='us-west-2';")
con.execute("SET s3_url_style='path';")

# (file, SQL, layer, minzoom, maxzoom, description)
jobs = [
    ("places.geojsonseq", f"""
      SELECT id, names.primary AS name, taxonomy.primary AS category,
             confidence, operating_status, addresses[1].freeform AS address,
             geometry
      FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*',
                        filename=true, hive_partitioning=1)
      WHERE {BBOX_SQL}
    """, "places", 7, 17, "Named places and POIs"),
    ("buildings.geojsonseq", f"""
      SELECT id, names.primary AS name, height, geometry
      FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=buildings/type=building/*',
                        filename=true, hive_partitioning=1)
      WHERE {BBOX_SQL}
    """, "buildings", 13, 17, "Building footprints"),
    ("roads.geojsonseq", f"""
      SELECT id, names.primary AS name, subtype, class, subclass, geometry
      FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=transportation/type=segment/*',
                        filename=true, hive_partitioning=1)
      WHERE subtype='road' AND {BBOX_SQL}
    """, "roads", 7, 17, "Road segments"),
    ("addresses.geojsonseq", f"""
      SELECT id, number, street, unit, postcode, country, geometry
      FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=addresses/type=address/*',
                        filename=true, hive_partitioning=1)
      WHERE country='YE' AND {BBOX_SQL}
    """, "addresses", 12, 17, "Address points (coverage depends on source data)"),
    ("placenames.geojsonseq", f"""
      SELECT id, subtype, names.primary AS name, geometry
      FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=divisions/type=division/*',
                        filename=true, hive_partitioning=1)
      WHERE subtype IN ('locality','neighborhood') AND {BBOX_SQL}
    """, "placenames", 5, 13, "Locality and neighborhood names"),
]

manifest = {
    "schema_version": 1,
    "source": "Overture Maps GeoParquet",
    "release": RELEASE,
    "bbox": [WEST, SOUTH, EAST, NORTH],
    "crs": "EPSG:4326",
    "tiles_format": "PMTiles v3 / Mapbox Vector Tiles",
    "layers": {},
}

for filename, sql, layer, minzoom, maxzoom, description in jobs:
    geojson = OUT / filename
    pmtiles = OUT / f"{layer}.pmtiles"
    try:
        con.execute(
            f"COPY ({sql}) TO '{geojson.as_posix()}' "
            "WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq', SRS 'EPSG:4326')"
        )
    except Exception as exc:
        raise RuntimeError(f"GeoParquet extraction failed for {layer}: {exc}") from exc

    # GeoJSONSeq has one feature per line; count without loading it all in RAM.
    count = sum(1 for line in geojson.open("r", encoding="utf-8") if line.strip())
    if count == 0:
        geojson.unlink(missing_ok=True)
        manifest["layers"][layer] = {
            "available": False, "feature_count": 0, "reason": "No features in this Overture release/bbox"
        }
        continue

    cmd = [
        "tippecanoe", "-f", "-o", str(pmtiles),
        "-Z", str(minzoom), "-z", str(maxzoom), "-l", layer, "-P",
        "--drop-densest-as-needed", "--extend-zooms-if-still-dropping",
        str(geojson),
    ]
    subprocess.run(cmd, check=True)
    geojson.unlink(missing_ok=True)
    manifest["layers"][layer] = {
        "available": True, "feature_count": count, "file": pmtiles.name,
        "minzoom": minzoom, "maxzoom": maxzoom, "description": description,
        "bytes": pmtiles.stat().st_size,
    }
    print(f"BUILT {layer}: {count} features, {pmtiles.stat().st_size} bytes")

manifest["total_features"] = sum(x.get("feature_count", 0) for x in manifest["layers"].values())
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifest, ensure_ascii=False, indent=2))

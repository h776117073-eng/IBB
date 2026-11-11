# Ibb Overture PMTiles build

This workflow creates a governorate-wide vector-tile set from the official Overture Maps GeoParquet release. It does not use Overture's Explorer-only PMTiles as a production dependency; it builds a project-owned tile archive from source data.

## Run

Open **Actions → Build Ibb Overture PMTiles → Run workflow**. Leave the release field blank to resolve the latest Overture STAC release, or enter a pinned release such as `2026-10-21.0`.

The workflow extracts the Ibb bounding box and builds separate PMTiles archives for:
- places / POIs
- building footprints
- road segments
- address points where Overture has Yemen coverage
- locality and neighborhood labels

The workflow publishes assets to the GitHub Release tag `ibb-overture-tiles-latest`. The generated `manifest.json` is the source of truth for actual feature counts and which layers are available. An unavailable/empty source layer is reported as such; it is never fabricated.

## Important source restrictions

The companion repository `mhommdkuyr/ibb-map-gis-downloader` contains a downloader that requests Google Maps tile endpoints directly. This project does **not** ingest or redistribute those Google-derived MBTiles/GeoTIFF/KMZ files. Google Maps Platform terms prohibit bulk tile downloading and rehosting unless a separate explicit agreement authorizes it. Use a source whose licence permits the intended hosting and caching.

## Coverage and accuracy

A successful build proves that source features were converted and validated, not that every address or business in Ibb exists in Overture. Overture's addresses theme has partial country coverage and should be treated as one source, not a complete address register. User-verified business records remain a separate dataset with their own verification states.

## Viewer integration

The map viewer must reference the published PMTiles archives through a byte-range-capable HTTPS origin with CORS enabled. Do not point a production viewer at Overture's own Explorer PMTiles: Overture documents those as inspection-only and warns that their layers and zooms may change without notice.

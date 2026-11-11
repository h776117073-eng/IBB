# Interactive Ibb Governorate Map

Open `/map-viewer/` on the Ibb Market site. The viewer uses MapLibre GL JS and PMTiles to request only the visible vector-tile byte ranges.

## Layers

- Overture places / points of interest
- Overture building footprints
- Overture road segments
- Overture address points, only when the release has Yemen coverage
- Overture locality and neighborhood labels
- Esri World Imagery and OpenStreetMap raster background modes

## Tile delivery

The viewer requests `/tiles/overture/{file}` from the `ibb-map-tiles` Cloudflare Worker. The Worker first checks the `ibb-map-tiles` R2 bucket and then falls back to the GitHub Release `ibb-overture-tiles-latest`. It forwards HTTP Range requests and exposes the range headers needed by PMTiles.

The map is not considered data-ready until the Actions workflow **Build Ibb Overture PMTiles** succeeds, the release contains the PMTiles assets and `manifest.json`, and the Worker byte-range delivery check returns HTTP 206.

## Data quality and licensing

Overture's address theme is partial and includes varied upstream source licences. Its existence does not prove complete street-address coverage for Ibb. Overture places are not a complete business register and do not independently verify whether a shop is open or its owner.

The separate GIS downloader repository currently uses direct Google Maps tile endpoints. Its Google-derived MBTiles/GeoTIFF/KMZ are not imported or re-hosted here without a separate explicit licence that permits bulk storage and redistribution. The map viewer uses imagery directly from Esri and an OSM background instead.

See [the PMTiles build notes](../docs/OVERTURE_PMTILES_BUILD.md) and [PR #14](https://github.com/h776117073-eng/IBB/pull/14).

# IBB Market Geo-Engine v5 — staged port

This branch ports the map renderer, local Arabic search worker, offline routing graph worker, and the source GeoJSON/JSON datasets into `map-v5/` without replacing the existing IBB Market map route.

## Integration safeguards
- The source repository's demo API and demo merchant/store integration modules are deliberately excluded.
- The foreign Supabase project URL and anonymous key are disabled; no source-project credentials are carried into IBB.
- The selected-place action queries the IBB Market map API by name and a tight geographic bounding box. It opens `market/place/?id=...` only when a matching published record is found within 120 metres; otherwise it reports that no published page exists.
- If the local routing graph cannot find a route, the engine reports no route instead of drawing a fabricated straight-line path.
- Contributions remain local/exportable in this port until an approved IBB server endpoint is added.

## Tile origin
The source PMTiles archives are not duplicated into Git history. The viewer temporarily reads the existing public PMTiles origin at `mhommdkuyr.github.io/my-ibb-governorate-map/pmtiles`. Replace this with the IBB Market Cloudflare tile endpoint after matching the source-layer schema and publishing compatible archives.

## Route
Open `/map-v5/` from the IBB Market home page. The previous `/map/` route remains intact.

## Validation
The branch workflow runs Geo-Engine syntax checks, local search/routing unit tests, JSON parsing and integration assertions, plus the existing IBB platform and Worker test suites.

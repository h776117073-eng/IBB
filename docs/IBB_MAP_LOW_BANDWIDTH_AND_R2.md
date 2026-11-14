# IBB Market Geo-Engine v5 — tile delivery and low-bandwidth policy

The viewer requests PMTiles from the same-origin `/tiles/` endpoint. The Pages Function at `functions/tiles/[[path]].js` accepts only allow-listed archive names, forwards HTTP byte ranges, and rejects full-archive downloads. It checks the private `MAP_TILES` R2 binding first and uses a fixed allow-listed upstream release URL only as a fallback.

Cloudflare Pages must bind the R2 bucket `ibb-map-tiles` to `MAP_TILES` in both Preview and Production. The live binding and archive inventory still require verification before production approval.

- IndexedDB byte-range cache budget: 64 MiB, least-recently-used eviction, 4 MiB maximum cached range.
- Existing range-cache entries are migrated into eviction metadata.
- Save-Data, 2G, or reported downlink below 1.2 Mbps enables low-data mode and reduces viewport results to 80.
- Supabase viewport requests are debounced, bounded, capped, aborted when superseded, and cached in memory for ten minutes.
- Satellite imagery and elevation tiles remain opt-in; the service worker does not cache those optional high-volume sources.
- The routing graph is not downloaded during service-worker installation.
- Street reference imagery is fetched only after the user opens the street-view panel.

CI covers JavaScript syntax, map unit/data checks, and five byte-range proxy tests. CI does not prove the R2 binding, archive schema compatibility, live Supabase behavior, or final browser rendering. Those require an authorized Cloudflare session and a throttled-network browser run with measured transfer sizes.

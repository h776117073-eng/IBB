# Google Maps workbook staging

This directory contains the normalized 7,015-row candidate set, split into 71 compressed files (`maps-candidates-001.json.gz.b64` through `maps-candidates-071.json.gz.b64`). Decode and validate with `python scripts/decode_staged_google_maps_shards.py`.

All records are UNVERIFIED and NEEDS_REVIEW; `is_public=0`. The raw 16,441-row sheet is excluded. The 2,035 records outside the approximate Ibb bbox have null public API coordinates and are quarantined. No candidate is published by this package.

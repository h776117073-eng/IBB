# Ibb Governorate Map and Routing Provider

## Coverage envelope

The interactive map opens on the full Ibb Governorate extent, not only Ibb city. The current OpenStreetMap/Nominatim relation is `383900`:

- South: `13.7049486`
- North: `14.4655897`
- West: `43.6516621`
- East: `44.6814870`

Reference: https://www.openstreetmap.org/relation/383900

The map uses this bounding envelope for its initial view and governorate reset. It is a rectangular extent, not a clipped administrative polygon; a simplified boundary overlay can be added separately. The API accepts a viewport envelope up to 4 degrees in either dimension so the governorate remains usable on portrait and wide screens.

## Route engine

The map UI supports two profiles through the public Valhalla demo endpoint:

- `auto` — driving
- `pedestrian` — walking

Endpoint: https://valhalla1.openstreetmap.de/route

The browser requests OSRM-compatible GeoJSON output using `format: "osrm"` and `shape_format: "geojson"`, then renders the route as a Leaflet line. It displays distance, estimated duration and a translated turn list. Users can set the origin by clicking the map or by granting browser location permission. Google Maps directions remain available as a fallback.

A smoke test between Ibb city and Jiblah succeeded for both driving and pedestrian profiles on 2026-11-10. The observed routes were approximately 4.5 km / 9 minutes by car and 3.5 km / 45 minutes on foot. Route availability and times depend on the current OpenStreetMap road/path graph.

## Public-demo constraints

The Valhalla demo is suitable for a low-volume pilot, not a production SLA. The UI throttles route requests to at least 1.2 seconds apart and sends an `X-Client-Id` header identifying the site. Do not run bulk route calculations or precompute every pair of places against the demo service.

Before significant public traffic or commercial scaling, move routing to a dedicated Valhalla deployment or a contracted routing provider, add server-side caching and monitoring, and preserve the same `auto` / `pedestrian` interface.

## Attribution

- Map tiles and underlying geographic data: © OpenStreetMap contributors — https://www.openstreetmap.org/copyright
- Routing engine: Valhalla — https://github.com/valhalla/valhalla

const RELEASE = 'https://github.com/mhommdkuyr/ibb-map-gis-downloader/releases/download/v1.1.0-ibb-map-full/';
const EXTERNAL_ASSETS = {
  'roads.pmtiles': `${RELEASE}roads.pmtiles`,
  'settlements.pmtiles': `${RELEASE}settlements.pmtiles`,
  'buildings.pmtiles': `${RELEASE}buildings.pmtiles`
};
const ALIASES = {
  'buildings_z14_17.pmtiles': 'buildings.pmtiles',
  'buildings_z18.pmtiles': 'buildings.pmtiles'
};
const ALLOWED_ASSETS = new Set([
  'base.pmtiles', 'districts.pmtiles', 'governorate.pmtiles', 'places.pmtiles',
  'roads.pmtiles', 'settlements.pmtiles', 'buildings.pmtiles'
]);

export function parseByteRange(value, size) {
  if (typeof value !== 'string' || !Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null;
  const end = Math.min(requestedEnd, size - 1);
  return { start, end, length: end - start + 1 };
}

function tileHeaders(extra = {}) {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/vnd.pmtiles');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  let requested = Array.isArray(params?.path) ? params.path.join('/') : String(params?.path || '');
  try { requested = decodeURIComponent(requested); } catch { return new Response('Invalid asset path', { status: 400 }); }
  if (!requested || requested.includes('/') || requested.includes('..')) return new Response('Not found', { status: 404 });
  const asset = ALIASES[requested] || requested;
  if (!ALLOWED_ASSETS.has(asset)) return new Response('Not found', { status: 404 });

  try {
    const key = `pmtiles/${asset}`;
    const stored = await env.MAP_TILES.head(key);
    if (stored) {
      const headers = tileHeaders();
      headers.set('Content-Length', String(stored.size));
      if (stored.httpEtag) headers.set('ETag', stored.httpEtag);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
      const range = parseByteRange(request.headers.get('Range'), stored.size);
      if (!range) {
        headers.set('Content-Range', `bytes */${stored.size}`);
        return new Response(null, { status: 416, headers });
      }
      const object = await env.MAP_TILES.get(key, { range: { offset: range.start, length: range.length } });
      if (!object) return new Response('Tile not found', { status: 404 });
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${stored.size}`);
      headers.set('Content-Length', String(range.length));
      if (object.httpEtag) headers.set('ETag', object.httpEtag);
      return new Response(object.body, { status: 206, headers });
    }

    const source = EXTERNAL_ASSETS[asset];
    if (!source) return new Response('Tile archive not found', { status: 404 });
    if (request.method === 'HEAD') {
      const upstream = await fetch(source, { method: 'HEAD', headers: { 'User-Agent': 'IBB-Market-Geo-Engine/5.0', Accept: 'application/octet-stream' } });
      if (!upstream.ok) return new Response('Upstream tile archive unavailable', { status: 502 });
      const headers = tileHeaders();
      for (const name of ['content-length', 'etag', 'last-modified']) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(null, { status: 200, headers });
    }

    const rangeHeader = request.headers.get('Range');
    if (!rangeHeader || !/^bytes=\d+-\d*$/.test(rangeHeader.trim())) {
      return new Response('A single byte-range request is required; full archive downloads are disabled', {
        status: 416, headers: { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
      });
    }
    const upstream = await fetch(source, {
      headers: { Range: rangeHeader, 'User-Agent': 'IBB-Market-Geo-Engine/5.0', Accept: 'application/octet-stream' }
    });
    if (upstream.status !== 206) {
      return new Response(`Upstream did not honor byte ranges (HTTP ${upstream.status})`, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const headers = tileHeaders();
    for (const name of ['content-range', 'content-length', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('Content-Range')) return new Response('Upstream range response is missing Content-Range', { status: 502 });
    return new Response(upstream.body, { status: 206, headers });
  } catch (error) {
    return new Response('Tile service temporarily unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

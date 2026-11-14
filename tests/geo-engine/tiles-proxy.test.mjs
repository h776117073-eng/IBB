import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../functions/tiles/[[path]].js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { onRequest, parseByteRange } = await import(moduleUrl);

test('parseByteRange validates and clamps a single byte range', () => {
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19, length: 10 });
  assert.deepEqual(parseByteRange('bytes=95-', 100), { start: 95, end: 99, length: 5 });
  assert.equal(parseByteRange('bytes=-10', 100), null);
  assert.equal(parseByteRange('bytes=100-110', 100), null);
  assert.equal(parseByteRange('bytes=1-2,4-5', 100), null);
});

test('private R2 tiles return only the requested 206 byte range', async () => {
  const bucket = {
    head: async () => ({ size: 100, httpEtag: '"r2-etag"' }),
    get: async (_key, options) => ({ body: new Response(new Uint8Array(options.range.length)).body, httpEtag: '"r2-etag"' })
  };
  const request = new Request('https://example.test/tiles/base.pmtiles', { headers: { Range: 'bytes=10-19' } });
  const response = await onRequest({ request, env: { MAP_TILES: bucket }, params: { path: 'base.pmtiles' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('X-IBB-Tile-Source'), 'r2');
  assert.equal(response.headers.get('Vary'), 'Range');
  assert.equal(response.headers.get('Content-Range'), 'bytes 10-19/100');
  assert.equal(response.headers.get('Content-Length'), '10');
  assert.equal((await response.arrayBuffer()).byteLength, 10);
});

test('unbounded GETs are rejected instead of downloading a full PMTiles archive', async () => {
  const bucket = { head: async () => ({ size: 100, httpEtag: '"r2-etag"' }), get: async () => { throw new Error('must not fetch full object'); } };
  const response = await onRequest({ request: new Request('https://example.test/tiles/base.pmtiles'), env: { MAP_TILES: bucket }, params: { path: 'base.pmtiles' } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('Content-Range'), 'bytes */100');
});

test('large upstream archives are proxied only with a Range header', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  try {
    globalThis.fetch = async (url, init) => {
      requestedUrl = String(url);
      assert.equal(init.headers.Range, 'bytes=0-15');
      return new Response(new Uint8Array(16), { status: 206, headers: { 'Content-Range': 'bytes 0-15/124356620', 'Content-Length': '16', ETag: '"origin"' } });
    };
    const bucket = { head: async () => null };
    const request = new Request('https://example.test/tiles/buildings.pmtiles', { headers: { Range: 'bytes=0-15' } });
    const response = await onRequest({ request, env: { MAP_TILES: bucket }, params: { path: 'buildings.pmtiles' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('X-IBB-Tile-Source'), 'upstream');
    assert.match(requestedUrl, /\/buildings\.pmtiles$/);
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-15/124356620');
    assert.equal((await response.arrayBuffer()).byteLength, 16);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unknown tile names are not forwarded to arbitrary origins', async () => {
  const response = await onRequest({ request: new Request('https://example.test/tiles/secret.txt'), env: { MAP_TILES: { head: async () => null } }, params: { path: 'secret.txt' } });
  assert.equal(response.status, 404);
});

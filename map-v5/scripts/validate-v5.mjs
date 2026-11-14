import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('map-v5');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert.match(html, /src="\.\/js\/app\.js"/);
assert.match(html, /id="pc-open-store"/);
assert.doesNotMatch(html, /ibb-api-service\.js|ibb-store-integration\.js/);
assert.match(app, /pc-open-store/);
assert.match(app, /ibb-market-api\.aicreativestudio\.workers\.dev\/api\/v1\/map\/places/);
assert.match(app, /\.\.\/market\/place\/\?id=/);
assert.ok(app.includes("const SUPABASE_URL = 'https://gdgtwonxbujgxfiqivvp.supabase.co';"));
assert.ok(app.includes("const SUPABASE_ANON_KEY = 'sb_publishable_"));
assert.doesNotMatch(app, /eyJhbGciOiJIUzI1Ni/);
assert.ok(app.includes("const MAX_RANGE_CACHE_BYTES = 64 * 1024 * 1024;"));
assert.ok(app.includes("const PM_BASE = `${HOST_ORIGIN}/tiles`;"));
assert.doesNotMatch(app, /straightKm/);
assert.match(app, /تعذر إيجاد مسار على شبكة الطرق/);
assert.doesNotMatch(sw, /ibb-api-service\.js|ibb-store-integration\.js/);
for (const file of ['data/core_index.json','data/core_lite.json','data/ibb_routing_graph.json','data/settlements_full.json']) assert.ok(fs.existsSync(path.join(root,file)), 'Missing '+file);
let jsonCount=0;
function walk(dir){ for(const ent of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,ent.name); if(ent.isDirectory()) walk(p); else if(ent.name.endsWith('.json')){ JSON.parse(fs.readFileSync(p,'utf8')); jsonCount++; } } }
walk(path.join(root,'data'));
assert.ok(jsonCount >= 30, 'Expected the full district/city data shards');
console.log('Geo-Engine v5 integration validation passed; parsed '+jsonCount+' JSON data files.');

assert.match(app, /SUPA_SEARCH_CACHE = new Map/);
assert.match(app, /LOW_DATA_MODE \? 10 : 15/);
assert.match(app, /supaSearchAbortController\.abort\(\)/);

assert.match(app, /if \(!LOW_DATA_MODE\)/);
assert.match(app, /async function ensureRoutingGraphLoaded/);
assert.match(app, /if \(LOW_DATA_MODE\) return/);

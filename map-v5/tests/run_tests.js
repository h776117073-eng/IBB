const assert = require('assert');
const path = require('path');

// Mock Web Worker self for Node.js TDD
global.self = { postMessage: () => {} };

const searchWorker = require(path.join(__dirname, '../js/ibb-search-worker.js'));
const routingWorker = require(path.join(__dirname, '../js/ibb-routing-worker.js'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('PASS:', name);
    passed++;
  } catch (err) {
    console.error('FAIL:', name, '->', err.message);
    process.exitCode = 1;
  }
}

// --- Task 1 Tests: Spatial Cell Bucketing, Arabic Normalization, Plus Codes, Reverse Geocode ---
test('normalizeArabicQuery strips diacritics, alef variants, and leading ال', () => {
  assert.strictEqual(searchWorker.normalizeArabicQuery('المستشفى الجمهوري'), 'مستشفي جمهوري');
  assert.strictEqual(searchWorker.normalizeArabicQuery('إبَّانُ'), 'ابان');
});

test('encodePlusCode generates valid 10+ char OLC for Ibb center', () => {
  const code = searchWorker.encodePlusCode(13.97265, 44.16155);
  assert.ok(code.includes('+') && code.length >= 10, `Got ${code}`);
});

test('spatialCellKey groups nearby coordinates into same cell', () => {
  const c1 = searchWorker.spatialCellKey(13.97265, 44.16155);
  const c2 = searchWorker.spatialCellKey(13.97280, 44.16170);
  assert.strictEqual(c1, c2);
});

test('searchQuery finds normalized Arabic items and reverseGeocode returns nearest', () => {
  searchWorker.addItems([
    { name: 'مستشفى الثورة العام', cat: 'hospital', catAr: 'مستشفى', lat: 13.97631, lng: 44.17521, rating: 4.5 },
    { name: 'جامع الكبير', cat: 'mosque', catAr: 'مسجد', lat: 13.97631, lng: 44.18954, rating: 4.9 }
  ]);
  const res = searchWorker.searchQuery('الثوره', 13.975, 44.175, null, 10);
  assert.ok(res.matches.length >= 1 && res.matches[0].name.includes('الثورة'));
  const rev = searchWorker.reverseGeocode(13.97630, 44.17520);
  assert.ok(rev && rev.nearest && rev.nearest.name.includes('الثورة'));
});

// --- Task 2 Tests: Bearing-based Turn-by-Turn & Alternative Route ---
test('getTurnDirection computes right, left, and straight maneuvers in Arabic', () => {
  assert.ok(routingWorker.getTurnDirection(0, 90).includes('يميناً'));
  assert.ok(routingWorker.getTurnDirection(90, 0).includes('يساراً'));
  assert.ok(routingWorker.getTurnDirection(45, 50).includes('استمر'));
});

test('computeOfflineRoute returns primary route with turn maneuvers and optional alternative', () => {
  const mockGraph = {
    street_names: ['شارع العدين', 'شارع تعز', 'الدائري الغربي'],
    nodes: [
      [13.970, 44.160, 2030, 'تقاطع 0'],
      [13.970, 44.170, 2040, 'تقاطع 1'],
      [13.980, 44.170, 2050, 'تقاطع 2'],
      [13.980, 44.160, 2035, 'تقاطع 3']
    ],
    adj: [
      [[1, 1080, 'primary', 0, 0.01], [3, 1110, 'secondary', 2, 0.01]],
      [[2, 1110, 'primary', 1, 0.01]],
      [],
      [[2, 1080, 'secondary', 2, 0.01]]
    ]
  };
  const route = routingWorker.computeOfflineRoute(mockGraph, 13.970, 44.160, 13.980, 44.170, 'driving');
  assert.ok(route && route.distanceMeters > 1500);
  assert.ok(route.steps.some(s => s.text.includes('يساراً') || s.text.includes('يميناً')));
  assert.ok(Array.isArray(route.alternatives));
});

console.log(`Total passed: ${passed}`);

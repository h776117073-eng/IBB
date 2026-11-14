// عامل البحث المكاني المتقدم لمنصة إب ماركت (IBB Market Spatial Search Engine v5.0)
// يدعم: العربية والإنجليزية، التسامح مع الأخطاء الإملائية (Levenshtein <= 2)، المرادفات، Plus Codes، والترتيب المركب

const OLC_ALPHABET = '23456789CFGHJMPQRVWX';

const IBB_SYNONYMS = {
  'صيدليه': ['دواء', 'ادويه', 'فارما', 'pharmacy', 'drugstore'],
  'مستشفي': ['طوارئ', 'مستوصف', 'طبي', 'hospital', 'medical'],
  'عياده': ['مختبر', 'اشعه', 'اسنان', 'دكتور', 'طبيب', 'clinic', 'lab'],
  'مطعم': ['مطبخ', 'بروست', 'مندي', 'مشاوي', 'كفتيريا', 'restaurant', 'food'],
  'مقهي': ['كافيه', 'كافي', 'قهوه', 'عصائر', 'cafe', 'coffee'],
  'سوبرماركت': ['سوق', 'مول', 'هايبر', 'تموينات', 'بقاله', 'ماركت', 'supermarket', 'mall', 'market', 'grocery'],
  'فندق': ['اجنحه', 'منتجع', 'استراحه', 'لوكنده', 'hotel', 'resort'],
  'مدرسه': ['روضه', 'ثانويه', 'تعليم', 'school'],
  'جامعه': ['كليه', 'معهد', 'اكاديميه', 'university', 'college'],
  'مسجد': ['جامع', 'مصلي', 'mosque'],
  'وقود': ['محطه', 'بنزين', 'ديزل', 'غاز', 'gas', 'fuel'],
  'سيارات': ['ورشه', 'قطع غيار', 'بنشر', 'اطارات', 'ميكانيك', 'auto', 'car'],
  'الكترونيات': ['هواتف', 'جوالات', 'كمبيوتر', 'طاقة شمسيه', 'صيانه', 'electronics', 'mobile', 'solar']
};

function normalizeArabicQuery(text) {
  if (!text) return '';
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/(^|\s)ال([^\s]{2,})/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandWithSynonyms(token) {
  const expanded = new Set([token]);
  for (const [canon, syns] of Object.entries(IBB_SYNONYMS)) {
    if (canon === token || syns.includes(token)) {
      expanded.add(canon);
      syns.forEach(s => expanded.add(s));
    }
  }
  return Array.from(expanded);
}

function editDistanceLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = new Uint16Array(b.length + 1);
  const curr = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > 2) return 3;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function encodePlusCode(lat, lng) {
  let adjLat = Math.min(Math.max(lat + 90, 0), 179.999999);
  let adjLng = Math.min(Math.max(lng + 180, 0), 359.999999);
  let code = '';
  let latVal = Math.floor(adjLat * 8000);
  let lngVal = Math.floor(adjLng * 8000);
  for (let i = 0; i < 5; i++) {
    code = OLC_ALPHABET[latVal % 20] + OLC_ALPHABET[lngVal % 20] + code;
    latVal = Math.floor(latVal / 20);
    lngVal = Math.floor(lngVal / 20);
    if (i === 0) code = '+' + code;
  }
  return code;
}

function spatialCellKey(lat, lng, scale = 100) {
  const cy = Math.floor(lat * scale);
  const cx = Math.floor(lng * scale);
  return `${cy}:${cx}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ITEMS = [];
const SEEN = new Set();
const SPATIAL_CELLS = new Map();
let COORDS_F64 = new Float64Array(0);

function rebuildSpatialArray() {
  COORDS_F64 = new Float64Array(ITEMS.length * 2);
  for (let i = 0; i < ITEMS.length; i++) {
    COORDS_F64[i * 2] = ITEMS[i].lat;
    COORDS_F64[i * 2 + 1] = ITEMS[i].lng;
  }
}

function addItems(list) {
  let added = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || (!it.name && !it.name_ar) || isNaN(it.lat) || isNaN(it.lng)) continue;
    const name = it.name || it.name_ar;
    const nameEn = it.nameEn || it.name_en || '';
    const lat = +it.lat;
    const lng = +it.lng;
    const key = `${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (SEEN.has(key)) continue;
    SEEN.add(key);

    const plusCode = it.plusCode || it.plus_code || encodePlusCode(lat, lng);
    const cat = it.cat || it.category_code || 'shop';
    const catAr = it.catAr || it.category_ar || 'منشأة';
    const hara = it.hara || it.neighborhood_name_ar || '';
    const addr = it.addr || it.address_ar || '';
    const reg = it.reg || it.district_name_ar || 'محافظة إب';
    const norm = normalizeArabicQuery(`${name} ${nameEn} ${cat} ${catAr} ${hara} ${addr} ${reg} ${plusCode}`);
    const words = norm.split(' ').filter(Boolean);

    const idx = ITEMS.length;
    ITEMS.push({
      id: it.id || `poi_${idx}`,
      name,
      nameEn,
      cat,
      catAr,
      lat,
      lng,
      reg,
      hara,
      addr,
      plusCode,
      floors: it.floors || 4,
      elev: it.elev || it.elevation_m || 2040,
      rating: it.rating || 4.4,
      reviewsCount: it.reviewsCount || it.reviews_count || 18,
      phone: it.phone || '',
      web: it.web || it.website || '',
      openingHours: it.openingHours || it.opening_hours || 'يومياً: 8:00 ص - 10:30 م',
      merchantId: it.merchantId || it.merchant_id || null,
      storeId: it.storeId || it.store_id || null,
      verificationStatus: it.verificationStatus || it.verification_status || 'PUBLISHED',
      confidenceScore: it.confidenceScore || it.confidence_score || 0.95,
      src: it.src || it.source_code || 'قاعدة بيانات إب ماركت',
      norm,
      words
    });

    const cKey = spatialCellKey(lat, lng);
    if (!SPATIAL_CELLS.has(cKey)) SPATIAL_CELLS.set(cKey, []);
    SPATIAL_CELLS.get(cKey).push(idx);
    added++;
  }
  if (added > 0) rebuildSpatialArray();
  return added;
}

function reverseGeocode(lat, lng) {
  const cy = Math.floor(lat * 100);
  const cx = Math.floor(lng * 100);
  let best = null;
  let bestDist = Infinity;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = SPATIAL_CELLS.get(`${cy + dy}:${cx + dx}`);
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k++) {
        const it = ITEMS[bucket[k]];
        const d = haversineKm(lat, lng, it.lat, it.lng);
        if (d < bestDist) { bestDist = d; best = it; }
      }
    }
  }
  if (!best) {
    for (let i = 0; i < ITEMS.length; i++) {
      const it = ITEMS[i];
      const d = haversineKm(lat, lng, it.lat, it.lng);
      if (d < bestDist) { bestDist = d; best = it; }
    }
  }
  return {
    plusCode: encodePlusCode(lat, lng),
    nearest: best,
    distMeters: best ? Math.round(bestDist * 1000) : null
  };
}

function tokenMatchesItem(token, it) {
  const expansions = expandWithSynonyms(token);
  for (let e = 0; e < expansions.length; e++) {
    if (it.norm.includes(expansions[e])) return 2.0;
  }
  // Typo tolerance via Levenshtein <= 1 (or <= 2 for words >= 5 chars)
  if (token.length >= 4) {
    const maxDist = token.length >= 5 ? 2 : 1;
    for (let w = 0; w < it.words.length; w++) {
      if (editDistanceLevenshtein(token, it.words[w]) <= maxDist) return 1.2;
    }
  }
  return 0;
}

function searchQuery(q, centerLat, centerLng, catGroupSet, limit = 30, bbox = null) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const nq = normalizeArabicQuery(q);
  const tokens = nq.split(' ').filter(Boolean);
  const results = [];

  for (let i = 0; i < ITEMS.length; i++) {
    const it = ITEMS[i];
    if (catGroupSet && !catGroupSet.includes(it.cat)) continue;
    if (bbox && (it.lat < bbox.minLat || it.lat > bbox.maxLat || it.lng < bbox.minLng || it.lng > bbox.maxLng)) continue;

    let matchScore = 0;
    if (tokens.length === 0) {
      matchScore = 1.0;
    } else {
      let tokenSum = 0;
      let allMatched = true;
      for (let t = 0; t < tokens.length; t++) {
        const ts = tokenMatchesItem(tokens[t], it);
        if (ts === 0) { allMatched = false; break; }
        tokenSum += ts;
      }
      if (!allMatched) continue;
      const normName = normalizeArabicQuery(it.name);
      matchScore = normName.startsWith(nq) ? 3.5 : (normName.includes(nq) ? 2.6 : (tokenSum / tokens.length));
    }

    const distKm = (centerLat != null && centerLng != null)
      ? haversineKm(centerLat, centerLng, it.lat, it.lng)
      : 0;
    const distDecay = Math.exp(-distKm / 8.0);
    const ratingBoost = (it.rating || 4.0) / 5.0;
    const merchantBoost = it.merchantId ? 1.5 : 0;
    const totalScore = matchScore * 10 + distDecay * 4 + ratingBoost * 2 + merchantBoost;

    results.push({ item: it, distKm: +distKm.toFixed(2), score: totalScore });
  }

  results.sort((a, b) => b.score - a.score);
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    tookMs: +(now - t0).toFixed(2),
    totalIndexed: ITEMS.length,
    matches: results.slice(0, limit).map(r => ({ ...r.item, distKm: r.distKm }))
  };
}

if (typeof self !== 'undefined') {
  self.onmessage = (e) => {
    const { type, payload, reqId } = e.data || {};
    if (type === 'ADD_ITEMS') {
      const added = addItems(payload || []);
      self.postMessage({ type: 'ITEMS_ADDED', added, total: ITEMS.length });
    } else if (type === 'SEARCH') {
      const res = searchQuery(payload.q, payload.lat, payload.lng, payload.cats, payload.limit || 30, payload.bbox || null);
      self.postMessage({ type: 'SEARCH_RESULT', reqId, result: res });
    } else if (type === 'GEO_RAG') {
      const res = searchQuery(payload.q, payload.lat, payload.lng, payload.cats, 8);
      self.postMessage({ type: 'GEO_RAG_RESULT', reqId, result: res });
    } else if (type === 'REVERSE_GEOCODE') {
      const res = reverseGeocode(payload.lat, payload.lng);
      self.postMessage({ type: 'REVERSE_GEOCODE_RESULT', reqId, result: res });
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeArabicQuery, expandWithSynonyms, editDistanceLevenshtein,
    encodePlusCode, spatialCellKey, haversineKm, addItems, searchQuery, reverseGeocode
  };
}

(() => {
  'use strict';

  // 1. Service Worker & Persistent Storage Registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((granted) => {
      const el = document.getElementById('idb-persist-val');
      if (el) el.textContent = granted ? 'محمي دائم' : 'نشط قياسي';
    }).catch(() => {});
  }

  function safeGetStorage(key, fallbackJson) {
    try { return JSON.parse(localStorage.getItem(key) || fallbackJson); } catch { return JSON.parse(fallbackJson); }
  }
  function safeSetStorage(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }

  function showToast(msg, ms = 2800) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function updateNetStatus() {
    const dot = document.getElementById('net-dot');
    const txt = document.getElementById('net-text');
    if (!dot || !txt) return;
    if (navigator.onLine) {
      dot.classList.remove('offline');
      txt.textContent = 'متصل • كاش نشط';
    } else {
      dot.classList.add('offline');
      txt.textContent = 'وضع عدم الاتصال (Offline)';
    }
  }
  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);
  updateNetStatus();

  // 2. Plus Codes (Open Location Code) & Spatial Math
  const OLC_CHARS = '23456789CFGHJMPQRVWX';
  function encodePlusCode(lat, lon) {
    let adjLat = Math.min(Math.max(lat + 90.0, 0.0), 179.999999);
    let adjLon = Math.min(Math.max(lon + 180.0, 0.0), 359.999999);
    let code = '';
    let latVal = Math.floor(adjLat * 8000);
    let lonVal = Math.floor(adjLon * 8000);
    for (let i = 0; i < 5; i++) {
      code = OLC_CHARS[latVal % 20] + OLC_CHARS[lonVal % 20] + code;
      latVal = Math.floor(latVal / 20);
      lonVal = Math.floor(lonVal / 20);
      if (i === 0) code = '+' + code;
    }
    return code;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // 3. IndexedDB Byte-Range Cache for PMTiles (Solves CacheStorage HTTP 206 Partial Content limitation)
  const IDB_NAME = 'ibb_pmtiles_range_cache_v3';
  const IDB_STORE = 'ranges';
  let idbPromise = null;
  let idbCachedChunksCount = 0;

  const IDB_META_STORE = 'range_meta';
  const MAX_RANGE_CACHE_BYTES = 64 * 1024 * 1024;
  const MAX_SINGLE_RANGE_BYTES = 4 * 1024 * 1024;
  function openRangeDB() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 2);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
          if (!db.objectStoreNames.contains(IDB_META_STORE)) db.createObjectStore(IDB_META_STORE);
          const rangeStore = e.target.transaction.objectStore(IDB_STORE);
          const metaStore = e.target.transaction.objectStore(IDB_META_STORE);
          const cursorReq = rangeStore.openCursor();
          cursorReq.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            const value = cursor.value;
            metaStore.put({ size: value && value.byteLength ? value.byteLength : 0, touchedAt: 0 }, cursor.key);
            cursor.continue();
          };
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return idbPromise;
  }
  async function idbGetRange(key) {
    const db = await openRangeDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([IDB_STORE, IDB_META_STORE], 'readwrite');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => {
          const value = req.result || null;
          if (value) tx.objectStore(IDB_META_STORE).put({ size: value.byteLength || 0, touchedAt: Date.now() }, key);
          resolve(value);
        };
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  async function idbTrimRangeCache(db) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction([IDB_STORE, IDB_META_STORE], 'readwrite');
        const metaStore = tx.objectStore(IDB_META_STORE);
        const req = metaStore.getAll();
        req.onsuccess = () => {
          const entries = req.result || [];
          let total = entries.reduce((sum, item) => sum + (item.size || 0), 0);
          if (total <= MAX_RANGE_CACHE_BYTES) return;
          const keysReq = metaStore.getAllKeys();
          keysReq.onsuccess = () => {
            const ordered = entries.map((item, i) => ({ key: keysReq.result[i], ...item })).sort((x, y) => (x.touchedAt || 0) - (y.touchedAt || 0));
            const ranges = tx.objectStore(IDB_STORE);
            for (const item of ordered) {
              if (total <= MAX_RANGE_CACHE_BYTES) break;
              ranges.delete(item.key);
              metaStore.delete(item.key);
              total -= item.size || 0;
            }
          };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    });
  }
  async function idbPutRange(key, buf) {
    const db = await openRangeDB();
    if (!db || !buf || buf.byteLength > MAX_SINGLE_RANGE_BYTES) return;
    try {
      const tx = db.transaction([IDB_STORE, IDB_META_STORE], 'readwrite');
      tx.objectStore(IDB_STORE).put(buf, key);
      tx.objectStore(IDB_META_STORE).put({ size: buf.byteLength, touchedAt: Date.now() }, key);
      tx.oncomplete = () => idbTrimRangeCache(db);
      idbCachedChunksCount++;
      const el = document.getElementById('idb-chunks-val');
      if (el) el.textContent = idbCachedChunksCount.toLocaleString();
    } catch {}
  }

  class IndexedDBByteSource {
    constructor(url) {
      this.url = url;
    }
    getKey() {
      return this.url;
    }
    async getBytes(offset, length, signal, etag) {
      const cacheKey = `${this.url}:${offset}:${length}`;
      const cached = await idbGetRange(cacheKey);
      if (cached) {
        return { data: cached };
      }
      const res = await fetch(this.url, {
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
        signal
      });
      const buf = await res.arrayBuffer();
      idbPutRange(cacheKey, buf);
      return {
        data: buf,
        etag: res.headers.get('ETag') || etag,
        cacheControl: res.headers.get('Cache-Control') || undefined,
        expires: res.headers.get('Expires') || undefined
      };
    }
  }

  // 4. Regions, Categories & Panorama Street-View Nodes
  const REGIONS = [
    { code: 'U01_Ibb_City', name_ar: 'مدينة إب (المركز التجاري)', name_en: 'Ibb City Center', lat: 13.97265, lng: 44.16155, zoom: 16.5, kb: 340 },
    { code: 'D02_Al_Dhihar', name_ar: 'مديرية الظهار', name_en: 'Al Dhihar', lat: 13.97415, lng: 44.17480, zoom: 16, kb: 232 },
    { code: 'D03_Al_Mashannah', name_ar: 'مديرية المشنة والمدينة القديمة', name_en: 'Al Mashannah', lat: 13.97556, lng: 44.18589, zoom: 16.2, kb: 263 },
    { code: 'D01_Ibb', name_ar: 'مديرية إب (ريف إب)', name_en: 'Ibb District', lat: 13.9667, lng: 44.1833, zoom: 15, kb: 424 },
    { code: 'D04_Jiblah', name_ar: 'مديرية جبلة التاريخية', name_en: 'Jiblah', lat: 13.9241, lng: 44.1459, zoom: 16, kb: 195 },
    { code: 'U03_Al_Qaidah_City', name_ar: 'مدينة القاعدة', name_en: 'Al Qaidah City', lat: 13.7572, lng: 44.1388, zoom: 16.5, kb: 73 },
    { code: 'U04_Yarim_City', name_ar: 'مدينة يريم', name_en: 'Yarim City', lat: 14.2965, lng: 44.3757, zoom: 16.5, kb: 47 },
    { code: 'U02_Al_Udayn_City', name_ar: 'مدينة العدين', name_en: 'Al Udayn City', lat: 13.9700, lng: 43.9900, zoom: 16.5, kb: 20 },
    { code: 'U05_Dhi_As_Sufal_City', name_ar: 'مدينة ذي السفال', name_en: 'Dhi As Sufal', lat: 13.8355, lng: 44.1103, zoom: 16.5, kb: 30 },
    { code: 'U06_Al_Makhadir_City', name_ar: 'مدينة المخادر', name_en: 'Al Makhadir', lat: 14.1111, lng: 44.1993, zoom: 16.5, kb: 27 },
    { code: 'U07_An_Nadirah_City', name_ar: 'مدينة النادرة', name_en: 'An Nadirah', lat: 14.1015, lng: 44.4795, zoom: 16.5, kb: 29 },
    { code: 'U08_As_Saddah_City', name_ar: 'مدينة السدة', name_en: 'As Saddah', lat: 14.1661, lng: 44.3751, zoom: 16.5, kb: 8 },
    { code: 'D05_Badan', name_ar: 'مديرية بعدان وجبل ربي', name_en: "Ba'dan", lat: 13.9889, lng: 44.3231, zoom: 15, kb: 102 },
    { code: 'D06_As_Sabrah', name_ar: 'مديرية السبرة', name_en: 'As Sabrah', lat: 13.9160, lng: 44.3240, zoom: 15, kb: 65 },
    { code: 'D07_As_Sayyani', name_ar: 'مديرية السياني', name_en: 'As Sayyani', lat: 13.8139, lng: 44.1613, zoom: 15, kb: 112 },
    { code: 'D08_Dhi_As_Sufal', name_ar: 'مديرية ذي السفال', name_en: 'Dhi As Sufal', lat: 13.8355, lng: 44.1103, zoom: 15, kb: 129 },
    { code: 'D09_Mudhaykhirah', name_ar: 'مديرية مذيخرة', name_en: 'Mudhaykhirah', lat: 13.8661, lng: 43.9689, zoom: 15, kb: 156 },
    { code: 'D10_Al_Udayn', name_ar: 'مديرية العدين', name_en: 'Al Udayn', lat: 13.9700, lng: 43.9900, zoom: 15, kb: 150 },
    { code: 'D11_Far_Al_Udayn', name_ar: 'مديرية فرع العدين', name_en: 'Far Al Udayn', lat: 13.8997, lng: 43.8081, zoom: 15, kb: 184 },
    { code: 'D12_Hazm_Al_Udayn', name_ar: 'مديرية حزم العدين', name_en: 'Hazm Al Udayn', lat: 14.1146, lng: 43.9045, zoom: 15, kb: 35 },
    { code: 'D13_Hubaysh', name_ar: 'مديرية حبيش', name_en: 'Hubaysh', lat: 14.1161, lng: 44.0819, zoom: 15, kb: 96 },
    { code: 'D14_Al_Makhadir', name_ar: 'مديرية المخادر', name_en: 'Al Makhadir', lat: 14.1111, lng: 44.1993, zoom: 15, kb: 113 },
    { code: 'D15_Al_Qafr', name_ar: 'مديرية القفر', name_en: 'Al Qafr', lat: 14.2500, lng: 44.0800, zoom: 14.5, kb: 39 },
    { code: 'D16_Yarim', name_ar: 'مديرية يريم', name_en: 'Yarim', lat: 14.2965, lng: 44.3757, zoom: 15, kb: 137 },
    { code: 'D17_Ar_Radmah', name_ar: 'مديرية الرضمة', name_en: 'Ar Radmah', lat: 14.2000, lng: 44.5900, zoom: 15, kb: 63 },
    { code: 'D18_As_Saddah', name_ar: 'مديرية السدة', name_en: 'As Saddah', lat: 14.1661, lng: 44.3751, zoom: 15, kb: 106 },
    { code: 'D19_An_Nadirah', name_ar: 'مديرية النادرة', name_en: 'An Nadirah', lat: 14.1015, lng: 44.4795, zoom: 15, kb: 130 },
    { code: 'D20_Ash_Shair', name_ar: 'مديرية الشعر', name_en: "Ash Sha'ir", lat: 14.0139, lng: 44.3965, zoom: 15, kb: 82 }
  ];

  const CAT_GROUPS = {
    all: null,
    health: ['hospital', 'clinic', 'pharmacy'],
    food: ['restaurant', 'cafe', 'bakery'],
    mosque: ['mosque'],
    edu: ['school', 'university', 'bookstore'],
    shop: ['shop', 'supermarket', 'clothing', 'furniture', 'jewelry', 'electronics', 'salon'],
    biz: ['bank', 'company'],
    hotel: ['hotel'],
    gas: ['gas', 'auto'],
    street: ['street']
  };

  const CAT_AR = {
    shop: 'متجر / محل تجاري', hospital: 'مستشفى', clinic: 'عيادة / مختبر طبي',
    pharmacy: 'صيدلية', restaurant: 'مطعم', cafe: 'كافيه / مقهى', bakery: 'مخبز وحلويات',
    mosque: 'مسجد / جامع', school: 'مدرسة', university: 'جامعة / كلية / معهد',
    bookstore: 'مكتبة وقرطاسية', supermarket: 'سوبرماركت / مول', bank: 'بنك / شركة صرافة',
    company: 'شركة / مكتب هندسي وعقاري', hotel: 'فندق / منتجع سياحي', gas: 'محطة وقود',
    auto: 'قطع غيار وخدمات سيارات', street: 'شارع / جولة / زغط تاريخي', park: 'حديقة / متنزه',
    gym: 'نادي رياضي', electronics: 'هواتف ذكية وطاقة شمسية', furniture: 'أثاث ومفروشات',
    jewelry: 'ذهب ومجوهرات', clothing: 'أزياء وملبوسات', salon: 'مركز تجميل'
  };

  // Priority weight for Smart Label Collision (Lower = Higher Priority on GPU)
  const CAT_PRIORITY = {
    hospital: 1, university: 1, bank: 2, hotel: 2, mosque: 2, street: 2,
    supermarket: 3, pharmacy: 3, school: 3, restaurant: 4, clinic: 4, gas: 4,
    cafe: 5, company: 5, electronics: 5, shop: 6
  };

  const STREETVIEW_NODES = [
    {
      id: 'sv_udayn_st',
      title: 'شارع العدين التجاري — وسط مدينة إب',
      sub: 'الشريان التجاري الأول • الارتفاع: 2,046 م • 7H56X5FG+F7G',
      lat: 13.97415, lng: 44.17480, heading: 110,
      img: './assets/streetview_1.jpg',
      shops: ['مركز جرعان التجاري', 'بنك اليمن الدولي', 'الكريمي للصرافة', 'أبو أيمن للأجهزة الذكية', 'كيان كافي'],
      links: [{ id: 'sv_udayn_round', label: 'غرباً إلى جولة العدين ⬅️' }, { id: 'sv_old_city', label: 'شرقاً إلى المدينة القديمة ➡️' }]
    },
    {
      id: 'sv_old_city',
      title: 'المدينة القديمة وزغط الجامع الكبير — المشنة',
      sub: 'العمارة الحجرية التاريخية والقمريات • الارتفاع: 2,085 م • 7H56X5GQ+GRF',
      lat: 13.97631, lng: 44.18955, heading: 45,
      img: './assets/streetview_2.jpg',
      shops: ['زغط الجامع الكبير العمري', 'زغط جامع الأسدية', 'سوق البز الأعلى', 'باب الكبير التاريخي'],
      links: [{ id: 'sv_udayn_st', label: 'غرباً إلى شارع العدين ⬅️' }]
    },
    {
      id: 'sv_udayn_round',
      title: 'جولة العدين ومفترق الخط الدائري الغربي',
      sub: 'تقاطع المحاور الأربعة • الارتفاع: 2,030 م • 7H56X5F6+2J0',
      lat: 13.97265, lng: 44.16155, heading: 185,
      img: './assets/streetview_3.jpg',
      shops: ['سوق إب جولة العدين', 'آسيا للتسوق', 'ظمران سنتر', 'صيدلية النهي'],
      links: [{ id: 'sv_udayn_st', label: 'شرقاً إلى شارع العدين ➡️' }, { id: 'sv_thalatheen', label: 'جنوباً إلى شارع الثلاثين ⬇️' }]
    },
    {
      id: 'sv_thalatheen',
      title: 'شارع الثلاثين السياحي — مديرية الظهار',
      sub: 'منطقة الفنادق والمنتجعات • الارتفاع: 2,020 م • 7H56X595+800',
      lat: 13.96850, lng: 44.15650, heading: 260,
      img: './assets/streetview_4.jpg',
      shops: ['فندق هلتون إب السياحي', 'سوق الثلاثين', 'جامعة القلم للعلوم الإنسانية', 'مركز الورافي'],
      links: [{ id: 'sv_udayn_round', label: 'شمالاً إلى جولة العدين ⬆️' }]
    }
  ];

  // 5. Embedded Fallback Rich Dataset (So the app opens rich & instant even offline or inside isolated sandboxes)
  const INITIAL_CORE_POIS = [
    { name: 'جولة العدين (مفترق الطرق الأربعة)', cat: 'street', catAr: 'جولة رئيسية ومركز مروري', lat: 13.97265, lng: 44.16155, reg: 'مديرية الظهار', hara: 'حارة المرور / العدين', addr: 'تقاطع شارع العدين مع الخط الدائري الغربي وطريق السبل والمعاين', plusCode: '7H56X5F6+2J0', floors: 7, elev: 2030, rating: 4.7, phone: 'تقاطع حيوي 24 ساعة' },
    { name: 'شارع العدين التجاري', cat: 'street', catAr: 'الشريان التجاري الأول', lat: 13.97415, lng: 44.17480, reg: 'مديرية الظهار', hara: 'شارع العدين', addr: 'يمتد من جولة العدين غرباً حتى السوق المركزي وشارع تعز شرقاً', plusCode: '7H56X5FG+F7G', floors: 8, elev: 2046, rating: 4.8, phone: '' },
    { name: 'شارع تعز العام (الطريق الوطني N1)', cat: 'street', catAr: 'شريان رئيسي وتجاري', lat: 13.965413, lng: 44.181734, reg: 'مديرية الظهار', hara: 'شارع تعز', addr: 'يمتد من وسط المدينة جنوباً حتى مثلث المواصلات', plusCode: '7H56X58J+5M9', floors: 7, elev: 2042, rating: 4.6, phone: '' },
    { name: 'الخط الدائري الغربي', cat: 'street', catAr: 'طريق دائري سريع وتجاري', lat: 13.96350, lng: 44.17050, reg: 'مديرية الظهار', hara: 'الدائري الغربي', addr: 'يمتد من المعاين شمالاً مروراً بجولة العدين وظمران حتى مثلث المواصلات', plusCode: '7H56X5C7+R2M', floors: 8, elev: 2035, rating: 4.5, phone: '' },
    { name: 'شارع الثلاثين السياحي', cat: 'street', catAr: 'شارع الفنادق الراقية', lat: 13.96850, lng: 44.15650, reg: 'مديرية الظهار', hara: 'شارع الثلاثين', addr: 'غرب الخط الدائري وجولة العدين، إب', plusCode: '7H56X595+800', floors: 8, elev: 2020, rating: 4.7, phone: '' },
    { name: 'شارع المحافظة', cat: 'street', catAr: 'شارع إداري وتجاري', lat: 13.969438, lng: 44.177172, reg: 'مديرية المشنة', hara: 'حارة الحكومة المشنة', addr: 'وسط مدينة إب بين شارع تعز وشارع العدين', plusCode: '7H56X59G+QVF', floors: 7, elev: 2048, rating: 4.5, phone: '' },
    { name: 'زغط الجامع الكبير (حارة الجامع)', cat: 'street', catAr: 'زغط تاريخي مرصوف', lat: 13.976313, lng: 44.189547, reg: 'المدينة القديمة', hara: 'حارة الجامع المشنة', addr: 'من شارع الأوقاف وباب الكبير إلى ساحة الجامع الكبير العمري، إب القديمة', plusCode: '7H56X5GQ+GRF', floors: 5, elev: 2085, rating: 4.9, phone: '' },
    { name: 'زغط جامع الأسدية والمدرسة الأسدية', cat: 'street', catAr: 'زغط أثري وعلمي', lat: 13.976113, lng: 44.187953, reg: 'المدينة القديمة', hara: 'حارة السوق القديم', addr: 'شمال غرب الجامع الكبير، إب القديمة', plusCode: '7H56X5GQ+C5W', floors: 4, elev: 2078, rating: 4.8, phone: '' },
    { name: 'هيئة مستشفى الثورة العام / إب', cat: 'hospital', catAr: 'مستشفى حكومي مرجعي', lat: 13.97631, lng: 44.17521, reg: 'مديرية الظهار', hara: 'شارع مستشفى الثورة', addr: 'X5GC+G3F، شارع مستشفى الثورة، إب', plusCode: '7H56X5GC+G3F', floors: 6, elev: 2050, rating: 4.2, phone: '+967 774 801 232' },
    { name: 'مستشفى المجد التخصصي - إب', cat: 'hospital', catAr: 'مستشفى تخصصي', lat: 13.96480, lng: 44.18120, reg: 'مديرية الظهار', hara: 'شارع تعز', addr: 'شارع تعز، إب', plusCode: '7H56X58J+5M', floors: 6, elev: 2040, rating: 4.3, phone: '+967 775 353 600' },
    { name: 'مستشفى الكندي التخصصي', cat: 'hospital', catAr: 'مستشفى تخصصي', lat: 13.97080, lng: 44.17640, reg: 'مديرية الظهار', hara: 'شارع الملكة أروى', addr: 'شارع الملكة أروى، الظهار، إب', plusCode: '7H56X59G+QVF', floors: 6, elev: 2045, rating: 4.1, phone: '+967 770 564 361' },
    { name: 'مستشفى أطباء المنار إب', cat: 'hospital', catAr: 'مستشفى تخصصي 24 ساعة', lat: 13.95240, lng: 44.16810, reg: 'مديرية الظهار', hara: 'الدائري الغربي', addr: 'X52H+X69، طريق الدائري الغربي، إب', plusCode: '7H56X52H+X69', floors: 6, elev: 2025, rating: 4.0, phone: '+967 4 413 967' },
    { name: 'المركز المصري الطبي', cat: 'hospital', catAr: 'مركز طبي تخصصي', lat: 13.97180, lng: 44.17290, reg: 'مديرية الظهار', hara: 'الظهار', addr: 'الظهار، جوار جامع البر، إب', plusCode: '7H56X5CF+82', floors: 5, elev: 2042, rating: 4.4, phone: '+967 772 436 258' },
    { name: 'ظمران سنتر', cat: 'supermarket', catAr: 'مركز تسوق ومول تجاري', lat: 13.97210, lng: 44.16260, reg: 'مديرية الظهار', hara: 'الدائري الغربي', addr: 'X5C7+R2M، طريق الدائري الغربي، إب', plusCode: '7H56X5C7+R2M', floors: 7, elev: 2034, rating: 4.5, phone: '+967 4 456 747' },
    { name: 'مزايا سنتر Mazaia Center', cat: 'supermarket', catAr: 'مول ومركز تسوق', lat: 13.96620, lng: 44.18140, reg: 'مديرية الظهار', hara: 'شارع تعز', addr: 'شارع تعز، إب', plusCode: '7H56X58J+8H', floors: 6, elev: 2042, rating: 4.3, phone: '+967 771 725 322' },
    { name: 'مركز جرعان التجاري', cat: 'supermarket', catAr: 'مركز تسوق', lat: 13.97370, lng: 44.17570, reg: 'مديرية الظهار', hara: 'شارع العدين', addr: 'X5FG+F7G، شارع العدين، إب', plusCode: '7H56X5FG+F7G', floors: 6, elev: 2046, rating: 4.4, phone: '+967 777 402 624' },
    { name: 'بنك الكريمي للتمويل الأصغر الإسلامي', cat: 'bank', catAr: 'بنك ومصرف إسلامي', lat: 13.97320, lng: 44.17780, reg: 'مديرية المشنة', hara: 'وسط المدينة', addr: 'وسط المدينة، إب', plusCode: '7H56X5FH+74', floors: 5, elev: 2050, rating: 4.5, phone: '+967 4 534 193' },
    { name: 'عبده علي صالح العودي للصرافة', cat: 'bank', catAr: 'شركة صرافة وتحويلات', lat: 13.96944, lng: 44.17717, reg: 'مديرية المشنة', hara: 'شارع المحافظة', addr: 'X59G+QVF، شارع المحافظة، إب', plusCode: '7H56X59G+QVF', floors: 5, elev: 2048, rating: 4.7, phone: '+967 4 404 327' },
    { name: 'فندق هلتون إب السياحي', cat: 'hotel', catAr: 'فندق سياحي 24 ساعة', lat: 13.96850, lng: 44.15650, reg: 'مديرية الظهار', hara: 'شارع الثلاثين', addr: 'شارع الثلاثين، إب', plusCode: '7H56X595+800', floors: 7, elev: 2020, rating: 4.4, phone: '+967 770 223 322' },
    { name: 'فندق إب جاردن', cat: 'hotel', catAr: 'فندق وضيافة', lat: 13.97710, lng: 44.17590, reg: 'مديرية الظهار', hara: 'شارع مستشفى الثورة', addr: 'شارع مستشفى الثورة، إب', plusCode: '7H56X5GG+R9', floors: 6, elev: 2052, rating: 4.3, phone: '+967 4 409 991' },
    { name: 'فندق توب ابروتيل السياحي إب', cat: 'hotel', catAr: 'فندق سياحي', lat: 13.96120, lng: 44.16780, reg: 'مديرية الظهار', hara: 'الدائري الغربي', addr: 'بجوار مطاعم الدار، طريق الدائري الغربي، إب', plusCode: '7H56X569+F4', floors: 6, elev: 2032, rating: 4.2, phone: '+967 779 444 053' },
    { name: 'كيان كافي', cat: 'cafe', catAr: 'كافيه ومقهى مختص', lat: 13.97428, lng: 44.17682, reg: 'مديرية الظهار', hara: 'شارع العدين', addr: 'X5FG+PP8، شارع العدين، إب', plusCode: '7H56X5FG+PP8', floors: 4, elev: 2047, rating: 4.5, phone: '+967 770 634 720' },
    { name: 'جامعة القلم للعلوم الإنسانية والتطبيقية', cat: 'university', catAr: 'جامعة أهلية', lat: 13.97010, lng: 44.15520, reg: 'مديرية الظهار', hara: 'منطقة السبل', addr: 'السبل - بعد تقاطع خط الثلاثين، إب', plusCode: '7H56X5C4+23', floors: 6, elev: 2022, rating: 4.5, phone: '+967 777 446 336' },
    { name: 'الجامعة الوطنية - إب', cat: 'university', catAr: 'جامعة أهلية', lat: 13.96730, lng: 44.16810, reg: 'مديرية الظهار', hara: 'شارع الجامعة', addr: 'X589+W62، شارع الجامعة، إب', plusCode: '7H56X589+W62', floors: 6, elev: 2038, rating: 4.3, phone: '+967 4 401 620' },
    { name: 'صيدلية نور فارما', cat: 'pharmacy', catAr: 'صيدلية 24 ساعة', lat: 13.95970, lng: 44.18070, reg: 'مديرية المشنة', hara: 'شارع تعز', addr: 'X55J+V7H، إب', plusCode: '7H56X55J+V7H', floors: 4, elev: 2036, rating: 4.9, phone: '+967 774 612 370' },
    { name: 'صيدلية النهي', cat: 'pharmacy', catAr: 'صيدلية', lat: 13.97302, lng: 44.16605, reg: 'مديرية الظهار', hara: 'شارع العدين', addr: 'طلعة المرور، شارع العدين، X5F8+6C3، إب', plusCode: '7H56X5F8+6C3', floors: 5, elev: 2036, rating: 4.6, phone: '+967 4 400 794' }
  ];

  // 6. Initialize Background Web Workers (Inline Blob Fallback + External Worker Support)
  function createSearchWorker() {
    const workerCode = `
      const OLC_ALPHABET = '23456789CFGHJMPQRVWX';
      function normalizeArabicQuery(text) {
        if (!text) return '';
        return text.toString().trim().toLowerCase()
          .replace(/[\\u064B-\\u0652\\u0670\\u0640]/g, '')
          .replace(/[آأإٱ]/g, 'ا')
          .replace(/ة/g, 'ه')
          .replace(/ى/g, 'ي')
          .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
          .replace(/\\s+/g, ' ');
      }
      function encodePlusCode(lat, lng) {
        let adjLat = Math.min(Math.max(lat + 90, 0), 179.999999);
        let adjLng = Math.min(Math.max(lng + 180, 0), 359.999999);
        let code = '';
        let latVal = Math.floor(adjLat * 8000), lngVal = Math.floor(adjLng * 8000);
        for (let i = 0; i < 5; i++) {
          code = OLC_ALPHABET[latVal % 20] + OLC_ALPHABET[lngVal % 20] + code;
          latVal = Math.floor(latVal / 20); lngVal = Math.floor(lngVal / 20);
          if (i === 0) code = '+' + code;
        }
        return code;
      }
      function haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371, toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      const ITEMS = [];
      const SEEN = new Set();
      function addItems(list) {
        let added = 0;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (!it || !it.name || isNaN(it.lat) || isNaN(it.lng)) continue;
          const key = it.name + '|' + (+it.lat).toFixed(4) + '|' + (+it.lng).toFixed(4);
          if (SEEN.has(key)) continue;
          SEEN.add(key);
          const plusCode = it.plusCode || encodePlusCode(+it.lat, +it.lng);
          const norm = normalizeArabicQuery(it.name + ' ' + (it.catAr || '') + ' ' + (it.hara || '') + ' ' + (it.addr || '') + ' ' + (it.reg || '') + ' ' + plusCode);
          ITEMS.push({
            id: it.id || ('poi_' + ITEMS.length),
            name: it.name, cat: it.cat || 'shop', catAr: it.catAr || 'منشأة',
            lat: +it.lat, lng: +it.lng, reg: it.reg || 'محافظة إب',
            hara: it.hara || '', addr: it.addr || '', plusCode,
            floors: it.floors || 4, elev: it.elev || 2040, rating: it.rating || 4.3,
            phone: it.phone || '', web: it.web || '', src: it.src || 'قاعدة بيانات خريطتي', norm
          });
          added++;
        }
        return added;
      }
      function searchQuery(q, centerLat, centerLng, cats, limit) {
        const t0 = performance.now();
        const nq = normalizeArabicQuery(q);
        const tokens = nq.split(' ').filter(Boolean);
        const results = [];
        for (let i = 0; i < ITEMS.length; i++) {
          const it = ITEMS[i];
          if (cats && !cats.includes(it.cat)) continue;
          let matchScore = 1;
          if (tokens.length > 0) {
            let ok = true;
            for (let t = 0; t < tokens.length; t++) {
              if (!it.norm.includes(tokens[t])) { ok = false; break; }
            }
            if (!ok) continue;
            matchScore = it.norm.startsWith(nq) ? 3.2 : (normalizeArabicQuery(it.name).includes(nq) ? 2.4 : 1.3);
          }
          const distKm = (centerLat != null && centerLng != null) ? haversineKm(centerLat, centerLng, it.lat, it.lng) : 0;
          const score = matchScore * 10 + Math.exp(-distKm / 8.0) * 4 + ((it.rating || 4.2) / 5.0) * 2;
          results.push({ item: it, distKm: +distKm.toFixed(2), score });
        }
        results.sort((a, b) => b.score - a.score);
        return {
          tookMs: +(performance.now() - t0).toFixed(2),
          totalIndexed: ITEMS.length,
          matches: results.slice(0, limit || 30).map(r => Object.assign({}, r.item, { distKm: r.distKm }))
        };
      }
      self.onmessage = (e) => {
        const { type, payload, reqId } = e.data || {};
        if (type === 'ADD_ITEMS') {
          const added = addItems(payload || []);
          self.postMessage({ type: 'ITEMS_ADDED', added, total: ITEMS.length });
        } else if (type === 'SEARCH' || type === 'GEO_RAG') {
          const res = searchQuery(payload.q, payload.lat, payload.lng, payload.cats, payload.limit || 25);
          self.postMessage({ type: type + '_RESULT', reqId, result: res });
        }
      };
    `;
    try {
      return new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' })));
    } catch {
      return new Worker('./js/ibb-search-worker.js');
    }
  }

  function createRoutingWorker() {
    const workerCode = `
      class MinHeap {
        constructor() { this.data = []; }
        push(node, priority) { this.data.push({ node, priority }); this._up(this.data.length - 1); }
        pop() {
          const top = this.data[0], bottom = this.data.pop();
          if (this.data.length > 0) { this.data[0] = bottom; this._down(0); }
          return top;
        }
        _up(i) {
          while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.data[p].priority <= this.data[i].priority) break;
            [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
            i = p;
          }
        }
        _down(i) {
          const len = this.data.length;
          while ((i << 1) + 1 < len) {
            let left = (i << 1) + 1, right = left + 1, min = i;
            if (this.data[left].priority < this.data[min].priority) min = left;
            if (right < len && this.data[right].priority < this.data[min].priority) min = right;
            if (min === i) break;
            [this.data[i], this.data[min]] = [this.data[min], this.data[i]];
            i = min;
          }
        }
        get size() { return this.data.length; }
      }
      const SPEEDS = { trunk: 50, primary: 40, secondary: 30, tertiary: 22, residential: 16, footway: 4.5 };
      function haversineMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000, toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      function nearestNode(graph, lat, lon) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < graph.nodes.length; i++) {
          const d = haversineMeters(lat, lon, graph.nodes[i][0], graph.nodes[i][1]);
          if (d < bestD) { bestD = d; best = i; }
        }
        return { id: best, dist: Math.round(bestD), node: graph.nodes[best] };
      }
      function runAStar(graph, sLat, sLon, eLat, eLon, mode) {
        const t0 = performance.now();
        const { nodes, adj, street_names } = graph;
        const sSnap = nearestNode(graph, sLat, sLon);
        const eSnap = nearestNode(graph, eLat, eLon);
        const startId = sSnap.id, endId = eSnap.id;
        const endNode = nodes[endId];
        const maxMps = mode === 'walking' ? 1.4 : (55 / 3.6);
        const gScore = new Float64Array(nodes.length).fill(Infinity);
        const prevNode = new Int32Array(nodes.length).fill(-1);
        const prevEdge = new Array(nodes.length).fill(null);
        const visited = new Uint8Array(nodes.length);
        const open = new MinHeap();
        gScore[startId] = 0;
        open.push(startId, 0);
        let explored = 0;
        while (open.size > 0) {
          const { node: u } = open.pop();
          if (u === endId) break;
          if (visited[u]) continue;
          visited[u] = 1;
          explored++;
          const edges = adj[u] || [];
          for (let i = 0; i < edges.length; i++) {
            const [to, dist, cls, sIdx, slope] = edges[i];
            const baseKmh = mode === 'walking' ? 4.5 : (SPEEDS[cls] || 20);
            const sf = slope > 0.08 ? 1.35 : (slope < -0.08 ? 1.15 : 1.0);
            const timeSec = (dist / (baseKmh / 3.6)) * sf;
            const tentG = gScore[u] + timeSec;
            if (tentG < gScore[to]) {
              gScore[to] = tentG;
              prevNode[to] = u;
              prevEdge[to] = { to, dist, cls, street: street_names[sIdx] || 'طريق محلي', slope: slope || 0 };
              const hSec = haversineMeters(nodes[to][0], nodes[to][1], endNode[0], endNode[1]) / maxMps;
              open.push(to, tentG + hSec);
            }
          }
        }
        if (gScore[endId] === Infinity) return null;
        const coords = [[eLon, eLat]];
        const rawSteps = [];
        let curr = endId;
        while (curr !== -1) {
          coords.push([nodes[curr][1], nodes[curr][0]]);
          if (prevEdge[curr]) rawSteps.push(prevEdge[curr]);
          curr = prevNode[curr];
        }
        coords.push([sLon, sLat]);
        coords.reverse();
        rawSteps.reverse();
        const merged = [];
        for (const s of rawSteps) {
          const last = merged[merged.length - 1];
          if (last && last.street === s.street) last.dist += s.dist;
          else merged.push({ street: s.street, dist: s.dist, slope: s.slope });
        }
        const steps = merged.map((s, idx) => {
          const dTxt = s.dist >= 1000 ? (s.dist / 1000).toFixed(2) + ' كم' : Math.round(s.dist) + ' م';
          const p = idx === 0 ? 'انطلق عبر' : (idx === merged.length - 1 ? 'اتجه إلى الوجهة عبر' : 'واصل في');
          const sl = s.slope > 0.06 ? ' (مرتفع جبلي)' : '';
          return { text: p + ' ' + s.street + ' لمسافة ' + dTxt + sl, distMeters: s.dist, street: s.street };
        });
        const totalDist = Math.round(rawSteps.reduce((a, b) => a + b.dist, 0) + sSnap.dist + eSnap.dist);
        const totalSec = Math.max(30, Math.round(gScore[endId] + (sSnap.dist + eSnap.dist) / (mode === 'walking' ? 1.3 : 6.5)));
        return {
          engine: 'محرك خريطتي المحلي (A* + CH Web Worker)',
          computeMs: +(performance.now() - t0).toFixed(2),
          exploredNodes: explored,
          durationSeconds: totalSec,
          distanceMeters: totalDist,
          geometry: { type: 'LineString', coordinates: coords },
          steps
        };
      }
      let GRAPH = null;
      self.onmessage = (e) => {
        const { type, payload, reqId } = e.data || {};
        if (type === 'INIT_GRAPH') {
          GRAPH = payload;
          self.postMessage({ type: 'GRAPH_READY', nodes: GRAPH.nodes.length });
        } else if (type === 'ROUTE' && GRAPH) {
          self.postMessage({ type: 'ROUTE_RESULT', reqId, result: runAStar(GRAPH, payload.startLat, payload.startLon, payload.endLat, payload.endLon, payload.mode) });
        }
      };
    `;
    try {
      return new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' })));
    } catch {
      return new Worker('./js/ibb-routing-worker.js');
    }
  }

  const searchWorker = createSearchWorker();
  const routingWorker = createRoutingWorker();
  const pendingWorkerReqs = new Map();
  let reqCounter = 1;

  searchWorker.onmessage = (e) => {
    const { type, reqId, result, total } = e.data || {};
    if (type === 'ITEMS_ADDED') {
      const st = document.getElementById('search-stats-txt');
      if (st) st.textContent = `الفهرس الكروي واللغوي (Web Worker): ${total.toLocaleString()} سجل نشط`;
    } else if ((type === 'SEARCH_RESULT' || type === 'GEO_RAG_RESULT') && pendingWorkerReqs.has(reqId)) {
      const resolve = pendingWorkerReqs.get(reqId);
      pendingWorkerReqs.delete(reqId);
      resolve(result);
    }
  };

  routingWorker.onmessage = (e) => {
    const { type, reqId, result } = e.data || {};
    if (type === 'ROUTE_RESULT' && pendingWorkerReqs.has(reqId)) {
      const resolve = pendingWorkerReqs.get(reqId);
      pendingWorkerReqs.delete(reqId);
      resolve(result);
    }
  };

  function workerSearch(q, lat, lng, cats, limit = 25) {
    return new Promise((resolve) => {
      const reqId = 's_' + (reqCounter++);
      pendingWorkerReqs.set(reqId, resolve);
      searchWorker.postMessage({ type: 'SEARCH', reqId, payload: { q, lat, lng, cats, limit } });
    });
  }

  function workerRoute(startLat, startLon, endLat, endLon, mode = 'driving') {
    return new Promise((resolve) => {
      const reqId = 'r_' + (reqCounter++);
      pendingWorkerReqs.set(reqId, resolve);
      setTimeout(() => {
        if (pendingWorkerReqs.has(reqId)) {
          pendingWorkerReqs.delete(reqId);
          resolve(null);
        }
      }, 2500);
      routingWorker.postMessage({ type: 'ROUTE', reqId, payload: { startLat, startLon, endLat, endLon, mode } });
    });
  }

  // Seed search worker immediately with initial core POIs
  searchWorker.postMessage({ type: 'ADD_ITEMS', payload: INITIAL_CORE_POIS });

  // Always resolve PMTiles from the live repository origin or current host
  const HOST_ORIGIN = window.location.origin + window.location.pathname.split('/map-v5')[0];
  const PM_BASE = `${HOST_ORIGIN}/tiles`;
  const networkInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const LOW_DATA_MODE = Boolean(networkInfo && (networkInfo.saveData || /(^|-)2g/.test(networkInfo.effectiveType || '') || (Number.isFinite(networkInfo.downlink) && networkInfo.downlink > 0 && networkInfo.downlink < 1.2)));

  // Lightweight 2D Canvas Fallback Map Engine for WebGL-disabled / Ultra-Weak Devices
  function createFallbackMap2D(containerId, initCenter, initZoom) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:grab;background:#f1f5f9;';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    let cLng = initCenter[0], cLat = initCenter[1], zoom = initZoom, pitch = 0, bearing = 0;
    let isDarkTheme = false, isSatTheme = false;
    const sources = {}, layers = {}, listeners = {};
    const emit = (ev, arg) => (listeners[ev] || []).forEach(fn => { try { fn(arg); } catch {} });

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }
    function lngLatToPx(lng, lat) {
      const scale = Math.pow(2, zoom) * 256 / 360;
      const cosLat = Math.cos(cLat * Math.PI / 180);
      const x = (lng - cLng) * scale * cosLat + container.clientWidth / 2;
      const y = (cLat - lat) * scale + container.clientHeight / 2;
      return [x, y];
    }
    function pxToLngLat(x, y) {
      const scale = Math.pow(2, zoom) * 256 / 360;
      const cosLat = Math.cos(cLat * Math.PI / 180);
      const lng = cLng + (x - container.clientWidth / 2) / (scale * cosLat);
      const lat = cLat - (y - container.clientHeight / 2) / scale;
      return { lng, lat };
    }

    let drawScheduled = false;
    function scheduleDraw() {
      if (drawScheduled) return;
      drawScheduled = true;
      requestAnimationFrame(() => { drawScheduled = false; draw(); });
    }

    function draw() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      ctx.fillStyle = isSatTheme ? '#1e293b' : (isDarkTheme ? '#0f172a' : '#eef2f6');
      ctx.fillRect(0, 0, w, h);

      // Subtle grid
      ctx.strokeStyle = isDarkTheme ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.18)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      // Draw Roads
      const roads = sources['core_roads_emb']?.features || [];
      ctx.strokeStyle = isDarkTheme ? '#334155' : '#cbd5e1';
      ctx.lineWidth = zoom >= 15 ? 3.2 : 1.8;
      ctx.lineCap = 'round';
      for (let i = 0; i < roads.length; i++) {
        const coords = roads[i].geometry?.coordinates;
        if (!coords || coords.length < 2) continue;
        ctx.beginPath();
        for (let j = 0; j < coords.length; j++) {
          const [px, py] = lngLatToPx(coords[j][0], coords[j][1]);
          if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // Draw 2.5D Buildings
      if (zoom >= 14.2) {
        const blds = sources['core_blds_emb']?.features || [];
        ctx.fillStyle = isDarkTheme ? 'rgba(51,65,85,0.75)' : 'rgba(203,213,225,0.85)';
        ctx.strokeStyle = isDarkTheme ? '#475569' : '#94a3b8';
        ctx.lineWidth = 0.7;
        for (let i = 0; i < blds.length; i++) {
          const ring = blds[i].geometry?.coordinates?.[0];
          if (!ring || ring.length < 3) continue;
          const [x0, y0] = lngLatToPx(ring[0][0], ring[0][1]);
          if (x0 < -60 || x0 > w + 60 || y0 < -60 || y0 > h + 60) continue;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          for (let j = 1; j < ring.length; j++) {
            const [px, py] = lngLatToPx(ring[j][0], ring[j][1]);
            ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      // Highlighted Building
      const hl = sources['hl-building']?.features || [];
      if (hl.length) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.78)';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.5;
        hl.forEach(f => {
          const ring = f.geometry?.coordinates?.[0] || [];
          if (!ring.length) return;
          ctx.beginPath();
          ring.forEach((pt, idx) => {
            const [px, py] = lngLatToPx(pt[0], pt[1]);
            if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
      }

      // Active A* Route
      const rt = sources['route-line']?.features || [];
      if (rt.length) {
        ctx.strokeStyle = '#0ea5e9';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        rt.forEach(f => {
          const coords = f.geometry?.coordinates || [];
          if (coords.length < 2) return;
          ctx.beginPath();
          coords.forEach((pt, idx) => {
            const [px, py] = lngLatToPx(pt[0], pt[1]);
            if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.stroke();
        });
      }

      // POIs
      const pois = sources['pois-src']?.features || [];
      let drawn = 0;
      ctx.font = '600 11px Cairo, sans-serif';
      ctx.textAlign = 'center';
      for (let i = 0; i < pois.length && drawn < 120; i++) {
        const f = pois[i];
        const [lng, lat] = f.geometry.coordinates;
        const [px, py] = lngLatToPx(lng, lat);
        if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
        drawn++;
        ctx.fillStyle = f.properties.color || '#10b981';
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        if (zoom >= 15 && drawn < 35) {
          ctx.fillStyle = isDarkTheme ? '#f8fafc' : '#0f172a';
          ctx.fillText(f.properties.name || '', px, py + 16);
        }
      }
    }

    // Pan & Zoom interactions
    let dragging = false, lastX = 0, lastY = 0, moved = false;
    canvas.addEventListener('mousedown', (e) => { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      lastX = e.clientX; lastY = e.clientY;
      const scale = Math.pow(2, zoom) * 256 / 360;
      const cosLat = Math.cos(cLat * Math.PI / 180);
      cLng -= dx / (scale * cosLat);
      cLat += dy / scale;
      scheduleDraw();
      emit('moveend');
    });
    window.addEventListener('mouseup', () => { dragging = false; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom = Math.max(8, Math.min(20, zoom + (e.deltaY < 0 ? 0.5 : -0.5)));
      scheduleDraw();
      emit('moveend');
    }, { passive: false });
    canvas.addEventListener('click', (e) => {
      if (moved) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const ll = pxToLngLat(x, y);
      const pois = sources['pois-src']?.features || [];
      let hit = null, bestD = 18;
      for (const f of pois) {
        const [px, py] = lngLatToPx(f.geometry.coordinates[0], f.geometry.coordinates[1]);
        const d = Math.hypot(px - x, py - y);
        if (d < bestD) { bestD = d; hit = f; }
      }
      if (hit) {
        emit('click:pois-dots', { features: [hit], lngLat: ll, point: { x, y } });
      } else {
        emit('click', { lngLat: ll, point: { x, y } });
      }
    });

    window.addEventListener('resize', resize);
    setTimeout(() => { resize(); emit('load'); }, 30);

    return {
      isFallback2D: true,
      getCenter: () => ({ lng: cLng, lat: cLat }),
      getZoom: () => zoom,
      getPitch: () => pitch,
      setPitch: (p) => { pitch = p; },
      setBearing: (b) => { bearing = b; },
      flyTo: (opts = {}) => {
        if (opts.center) { cLng = opts.center[0]; cLat = opts.center[1]; }
        if (opts.zoom !== undefined) zoom = opts.zoom;
        if (opts.pitch !== undefined) pitch = opts.pitch;
        scheduleDraw();
        emit('moveend');
      },
      jumpTo: (opts = {}) => {
        if (opts.center) { cLng = opts.center[0]; cLat = opts.center[1]; }
        if (opts.zoom !== undefined) zoom = opts.zoom;
        scheduleDraw();
      },
      getSource: (id) => ({
        setData: (d) => { sources[id] = d; scheduleDraw(); }
      }),
      addSource: (id, obj) => { sources[id] = obj.data || null; scheduleDraw(); },
      getLayer: (id) => layers[id] || null,
      addLayer: (l) => { layers[l.id] = l; scheduleDraw(); },
      setLayoutProperty: (id, prop, val) => {
        if (id === 'orbital-sat-layer') isSatTheme = (val === 'visible');
        if (id === 'bg' || id === 'sky') isDarkTheme = !isSatTheme && isDarkTheme;
        scheduleDraw();
      },
      setPaintProperty: (id, prop, val) => {
        if (id === 'bg' && prop === 'background-color') isDarkTheme = (val === '#090f1d' || val === '#0b1120');
        scheduleDraw();
      },
      setTerrain: () => {},
      setFilter: () => {},
      getCanvas: () => canvas,
      queryRenderedFeatures: () => [],
      on: (ev, a, b) => {
        const key = typeof a === 'string' ? (ev + ':' + a) : ev;
        const fn = typeof a === 'string' ? b : a;
        if (!listeners[key]) listeners[key] = [];
        listeners[key].push(fn);
      }
    };
  }

  let map;
  try {
    if (typeof maplibregl === 'undefined' || typeof pmtiles === 'undefined') {
      throw new Error('MapLibre or PMTiles CDN unavailable');
    }
    maplibregl.setRTLTextPlugin(
      'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
      true
    );
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', (params, abortController) => {
      const rawUrl = params.url.replace(/^pmtiles:\/\//, '');
      if (!protocol.tiles.get(rawUrl)) {
        const source = new IndexedDBByteSource(rawUrl);
        protocol.tiles.set(rawUrl, new pmtiles.PMTiles(source));
      }
      return protocol.tile(params, abortController);
    });
    map = new maplibregl.Map({
    container: 'map',
    center: [44.1680, 13.9715],
    zoom: 16.2,
    pitch: 54,
    bearing: -16,
    maxZoom: 20,
    minZoom: 8,
    antialias: true,
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        gov_pm:      { type: 'vector', url: `pmtiles://${PM_BASE}/governorate.pmtiles` },
        dist_pm:     { type: 'vector', url: `pmtiles://${PM_BASE}/districts.pmtiles` },
        base_pm:     { type: 'vector', url: `pmtiles://${PM_BASE}/base.pmtiles` },
        roads_pm:    { type: 'vector', url: `pmtiles://${PM_BASE}/roads.pmtiles` },
        bld_low_pm:  { type: 'vector', url: `pmtiles://${PM_BASE}/buildings_z14_17.pmtiles` },
        bld_high_pm: { type: 'vector', url: `pmtiles://${PM_BASE}/buildings_z18.pmtiles` },
        places_pm:   { type: 'vector', url: `pmtiles://${PM_BASE}/places.pmtiles` },
        sett_pm:     { type: 'vector', url: `pmtiles://${PM_BASE}/settlements.pmtiles` },
        orbital_sat: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256, maxzoom: 19
        },
        ibb_terrain_dem: {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15
        }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#f1f5f9' } },
        { id: 'raster-sat', type: 'raster', source: 'orbital_sat', layout: { visibility: 'none' } },
        {
          id: 'terrain-hillshade', type: 'hillshade', source: 'ibb_terrain_dem',
          layout: { visibility: 'none' },
          paint: { 'hillshade-exaggeration': 0.65, 'hillshade-shadow-color': '#0f172a', 'hillshade-accent-color': '#10b981' }
        },
        {
          id: 'landuse-fill', type: 'fill', source: 'base_pm', 'source-layer': 'landuse',
          paint: {
            'fill-color': ['match', ['get', 'subtype'], 'park', '#bbf7d0', 'forest', '#86efac', 'agriculture', '#dcfce7', 'commercial', '#fef08a', '#e2e8f0'],
            'fill-opacity': 0.55
          }
        },
        { id: 'water-fill', type: 'fill', source: 'base_pm', 'source-layer': 'water', paint: { 'fill-color': '#7dd3fc', 'fill-opacity': 0.85 } },
        { id: 'water-line', type: 'line', source: 'base_pm', 'source-layer': 'water', paint: { 'line-color': '#38bdf8', 'line-width': 2 } },
        { id: 'gov-line', type: 'line', source: 'gov_pm', 'source-layer': 'governorate', paint: { 'line-color': '#f59e0b', 'line-width': 2.2, 'line-dasharray': [4, 2] } },
        { id: 'dist-line', type: 'line', source: 'dist_pm', 'source-layer': 'district_area', paint: { 'line-color': '#10b981', 'line-width': 1.3, 'line-opacity': 0.7 } },
        {
          id: 'roads-casing', type: 'line', source: 'roads_pm', 'source-layer': 'segment',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#94a3b8',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 3.5, 1.2], 15, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 10, ['secondary', 'tertiary'], 7, 4], 19, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 22, ['secondary', 'tertiary'], 16, 10]]
          }
        },
        {
          id: 'roads-fill', type: 'line', source: 'roads_pm', 'source-layer': 'segment',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#f59e0b', 'primary', '#fbbf24', ['secondary', 'tertiary'], '#fef08a', '#ffffff'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 2.2, 0.7], 15, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 7.5, ['secondary', 'tertiary'], 5, 2.5], 19, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 18, ['secondary', 'tertiary'], 13, 7.5]]
          }
        },
        {
          id: 'buildings-3d-low', type: 'fill-extrusion', source: 'bld_low_pm', 'source-layer': 'building',
          minzoom: 14, maxzoom: 18,
          paint: {
            'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 10], 4, '#e2e8f0', 12, '#cbd5e1', 25, '#94a3b8'],
            'fill-extrusion-height': ['coalesce', ['get', 'height'], 10],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.90
          }
        },
        {
          id: 'buildings-3d-high', type: 'fill-extrusion', source: 'bld_high_pm', 'source-layer': 'building',
          minzoom: 18,
          paint: {
            'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 11], 4, '#e2e8f0', 12, '#cbd5e1', 25, '#94a3b8'],
            'fill-extrusion-height': ['coalesce', ['get', 'height'], 11],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.92
          }
        },
        {
          id: 'road-labels', type: 'symbol', source: 'roads_pm', 'source-layer': 'segment',
          minzoom: 14.5, filter: ['has', 'name'],
          layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-max-angle': 30 },
          paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 }
        },
        {
          id: 'district-labels', type: 'symbol', source: 'dist_pm', 'source-layer': 'district_area',
          minzoom: 9, maxzoom: 15,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13 },
          paint: { 'text-color': '#065f46', 'text-halo-color': '#ffffff', 'text-halo-width': 2.5 }
        },
        {
          id: 'settlement-labels', type: 'symbol', source: 'sett_pm', 'source-layer': 'settlement',
          minzoom: 12.2,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10.5, 16, 13], 'text-padding': 4 },
          paint: { 'text-color': '#0369a1', 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 }
        },
        {
          id: 'ov-places-dots', type: 'circle', source: 'places_pm', 'source-layer': 'place',
          minzoom: 13,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3.5, 18, 6], 'circle-color': '#10b981', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff' }
        },
        {
          id: 'ov-places-labels', type: 'symbol', source: 'places_pm', 'source-layer': 'place',
          minzoom: 13.5,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
          paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 }
        }
      ]
    }
    });
    map.getCanvas().addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      showToast('جاري استعادة سياق البطاقة الرسومية WebGL...');
    });
  } catch (webglErr) {
    console.warn('WebGL unavailable, activating 2D Canvas Fallback Engine:', webglErr);
    map = createFallbackMap2D('map', [44.1680, 13.9715], 16.2);
    showToast('تم تفعيل وضع العرض الخفيف (2D Canvas) الملائم للأجهزة الضعيفة');
  }


  // 7B. Supabase Cloud Geo-Database Integration (Weak-Internet Viewport Streaming & Contributions)
  const SUPABASE_URL = 'https://gdgtwonxbujgxfiqivvp.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_ziUReupVGc-Zpx8ukc0pVQ_cMipH5l2';
  const SUPA_HEADERS = { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  const SEEN_POI_KEYS = new Set(INITIAL_CORE_POIS.map(p => `${p.name}|${p.lat.toFixed(5)}|${p.lng.toFixed(5)}`));

  function mergeCloudPois(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    const fresh = [];
    for (const r of rows) {
      const lat = +r.lat, lng = +r.lng;
      const key = `${r.name}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
      if (SEEN_POI_KEYS.has(key)) continue;
      SEEN_POI_KEYS.add(key);
      fresh.push({
        name: r.name, cat: r.cat || 'shop', catAr: r.cat_ar || CAT_AR[r.cat] || 'منشأة',
        lat, lng, reg: r.reg || 'محافظة إب', hara: r.hara || '', addr: r.addr || '',
        plusCode: r.plus_code || '', floors: r.floors || 2, elev: r.elev || 2040,
        rating: r.rating || 4.5, phone: r.phone || ''
      });
    }
    if (fresh.length) {
      ALL_LOADED_POIS.push(...fresh);
      searchWorker.postMessage({ type: 'ADD_ITEMS', payload: fresh });
      updatePoiLayers();
    }
  }

  let supaTimer = null;
  let supaAbortController = null;
  const SUPA_VIEW_CACHE = new Map();
  function fetchSupabaseViewport(lat, lng, zoom) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !navigator.onLine || zoom < 11.5) return;
    clearTimeout(supaTimer);
    supaTimer = setTimeout(async () => {
      const span = Math.max(0.008, Math.min(0.08, 0.12 / Math.pow(2, Math.max(0, zoom - 12))));
      const bounds = [lng - span, lat - span, lng + span, lat + span].map(v => Number(v.toFixed(3)));
      const cacheKey = `${bounds.join(',')}|${Math.floor(zoom)}|${activeCatFilter}`;
      if (supaAbortController) supaAbortController.abort();
      const cached = SUPA_VIEW_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) { mergeCloudPois(cached.rows); return; }
      const controller = new AbortController();
      supaAbortController = controller;
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_ibb_pois_in_bbox`, {
          method: 'POST', headers: SUPA_HEADERS, signal: controller.signal,
          body: JSON.stringify({ min_lat: bounds[1], min_lng: bounds[0], max_lat: bounds[3], max_lng: bounds[2], filter_cat: activeCatFilter || 'all', max_rows: LOW_DATA_MODE ? 80 : 140 })
        });
        if (!res.ok) throw new Error(`Supabase viewport HTTP ${res.status}`);
        const rows = await res.json();
        if (!Array.isArray(rows)) return;
        SUPA_VIEW_CACHE.set(cacheKey, { at: Date.now(), rows });
        if (SUPA_VIEW_CACHE.size > 40) SUPA_VIEW_CACHE.delete(SUPA_VIEW_CACHE.keys().next().value);
        mergeCloudPois(rows);
      } catch (error) { if (error?.name !== 'AbortError') console.warn('Supabase viewport request failed', error); }
    }, LOW_DATA_MODE ? 700 : 450);
  }

  async function saveContributionToSupabase(item) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !navigator.onLine) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/ibb_contributions`, {
        method: 'POST',
        headers: SUPA_HEADERS,
        body: JSON.stringify({
          name: item.name, cat: item.cat, lat: item.lat, lng: item.lng,
          reg: 'توثيق ميداني', hara: item.hara || '', addr: item.notes || '', phone: item.phone || ''
        })
      });
    } catch {}
  }

  // 8. State & Dynamic GeoJSON Sources (POIs, Highlighted 3D Building, Routing, StreetView)
  const ALL_LOADED_POIS = [...INITIAL_CORE_POIS];
  const LOADED_SHARDS = new Set();
  let activeCatFilter = 'all';
  let is3D = true;
  let isTerrain = false;
  let pickMode = null;
  let dirProfile = 'driving';
  let dirOrigin = { lat: 13.97265, lng: 44.16155, label: 'جولة العدين (المركز)' };
  let dirDest = { lat: 13.96850, lng: 44.15650, label: 'شارع الثلاثين السياحي' };
  let lastSelectedPlace = INITIAL_CORE_POIS[0];
  let lastComputedRoute = null;

  document.getElementById('dir-origin').value = dirOrigin.label;
  document.getElementById('dir-dest').value = dirDest.label;

  function makeBuildingFootprintPolygon(lat, lng, radiusDeg = 0.00013) {
    return [
      [lng - radiusDeg, lat - radiusDeg * 0.85],
      [lng + radiusDeg, lat - radiusDeg * 0.85],
      [lng + radiusDeg, lat + radiusDeg * 0.85],
      [lng - radiusDeg, lat + radiusDeg * 0.85],
      [lng - radiusDeg, lat - radiusDeg * 0.85]
    ];
  }

  function highlightBuildingForPlace(place) {
    if (!map.getSource('bound-building')) return;
    const h = (place.floors || 5) * 3.5;
    const poly = makeBuildingFootprintPolygon(place.lat, place.lng, 0.00014);
    map.getSource('bound-building').setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [poly] },
        properties: { name: place.name, height: h }
      }]
    });
  }

  function updatePoiLayers() {
    if (!map.getSource('shard-pois')) return;
    const allowed = CAT_GROUPS[activeCatFilter];
    const bounds = map.getBounds();
    const minLng = bounds.getWest() - 0.015, maxLng = bounds.getEast() + 0.015;
    const minLat = bounds.getSouth() - 0.015, maxLat = bounds.getNorth() + 0.015;

    const features = [];
    for (let i = 0; i < ALL_LOADED_POIS.length; i++) {
      const p = ALL_LOADED_POIS[i];
      if (allowed && !allowed.includes(p.cat)) continue;
      if (p.lat < minLat || p.lat > maxLat || p.lng < minLng || p.lng > maxLng) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: {
          name: p.name,
          cat: p.cat,
          catAr: p.catAr || CAT_AR[p.cat] || p.cat,
          reg: p.reg || 'محافظة إب',
          hara: p.hara || '',
          addr: p.addr || '',
          plusCode: p.plusCode || encodePlusCode(p.lat, p.lng),
          floors: p.floors || 4,
          elev: p.elev || 2040,
          rating: p.rating || 4.3,
          phone: p.phone || '',
          priority: CAT_PRIORITY[p.cat] || 6
        }
      });
      if (features.length >= 1600) break;
    }
    map.getSource('shard-pois').setData({ type: 'FeatureCollection', features });
  }

  async function fetchJsonWithFallback(relPath) {
    try {
      const r = await fetch(relPath);
      if (r.ok) return await r.json();
    } catch {}
    try {
      const r2 = await fetch(`${HOST_ORIGIN}/${relPath.replace(/^\.\//, '')}`);
      if (r2.ok) return await r2.json();
    } catch {}
    return null;
  }

  async function loadNearestShard(lat, lng) {
    let best = REGIONS[0], bestDist = 1e9;
    for (const r of REGIONS) {
      const d = haversineKm(lat, lng, r.lat, r.lng);
      if (d < bestDist) { bestDist = d; best = r; }
    }
    if (LOADED_SHARDS.has(best.code)) {
      updatePoiLayers();
      return;
    }
    LOADED_SHARDS.add(best.code);
    const rows = await fetchJsonWithFallback(`./data/shards/${best.code}.json`);
    if (Array.isArray(rows)) {
      const batch = rows.map(r => ({
        name: r[0], cat: r[1] || 'shop', catAr: CAT_AR[r[1]] || r[1],
        lat: +r[2], lng: +r[3], plusCode: r[5] || '', reg: r[7] || best.name_ar,
        floors: 4, elev: 2035, rating: 4.2
      }));
      ALL_LOADED_POIS.push(...batch);
      searchWorker.postMessage({ type: 'ADD_ITEMS', payload: batch });
      updatePoiLayers();
    }
  }

  // Load enriched POIs, core_lite, and offline routing graph
  async function bootstrapDataPipelines() {
    if (window.__IBB_EMBEDDED_GRAPH__ && window.__IBB_EMBEDDED_GRAPH__.nodes) {
      routingWorker.postMessage({ type: 'INIT_GRAPH', payload: window.__IBB_EMBEDDED_GRAPH__ });
    }
    if (Array.isArray(window.__IBB_EMBEDDED_POIS__)) {
      const mappedEmb = window.__IBB_EMBEDDED_POIS__.map(r => ({
        name: r[0], cat: r[1], catAr: r[2], lat: +r[3], lng: +r[4],
        reg: r[5], hara: r[6], addr: r[7], plusCode: r[8],
        floors: r[9], elev: r[10], rating: r[11], phone: r[12]
      }));
      ALL_LOADED_POIS.push(...mappedEmb);
      searchWorker.postMessage({ type: 'ADD_ITEMS', payload: mappedEmb });
      updatePoiLayers();
    }

    const routingGraph = await fetchJsonWithFallback('./data/ibb_routing_graph.json');
    if (routingGraph && routingGraph.nodes) {
      routingWorker.postMessage({ type: 'INIT_GRAPH', payload: routingGraph });
    }

    // Progressive chunked streaming for weak internet & low-end devices
    for (let ci = 1; ci <= 10; ci++) {
      const chunk = await fetchJsonWithFallback(`./data/ibb_pois_${ci}.json`);
      if (Array.isArray(chunk) && chunk.length) {
        const mapped = chunk.map(r => ({
          name: r[0], cat: r[1], catAr: r[2], lat: +r[3], lng: +r[4],
          reg: r[5], hara: r[6], addr: r[7], plusCode: r[8],
          floors: r[9], elev: r[10], rating: r[11], phone: r[12]
        }));
        ALL_LOADED_POIS.push(...mapped);
        searchWorker.postMessage({ type: 'ADD_ITEMS', payload: mapped });
        updatePoiLayers();
        await new Promise(res => setTimeout(res, 16));
      }
    }

    const core = await fetchJsonWithFallback('./data/core_lite.json');
    if (core) {
      const ov = (core.overture_places || []).map(p => ({
        name: p.n, cat: p.c || 'company', catAr: p.ca || 'منشأة',
        lat: +p.lat, lng: +p.lng, reg: 'محافظة إب', phone: p.ph || '', web: p.w || ''
      }));
      ALL_LOADED_POIS.push(...ov);
      searchWorker.postMessage({ type: 'ADD_ITEMS', payload: ov });
      updatePoiLayers();
    }

    const idx = await fetchJsonWithFallback('./data/core_index.json');
    if (idx) {
      const setts = (idx.major_settlements || []).map(s => ({
        name: s[0], cat: 'settlement', catAr: 'قرية / تجمع سكني', lat: +s[4], lng: +s[5], reg: 'محافظة إب'
      }));
      searchWorker.postMessage({ type: 'ADD_ITEMS', payload: setts });
    }
  }

  map.on('load', () => {
    // Instant Embedded 3D Buildings & Road Network Layers (Zero-Latency Boot)
    if (window.__IBB_CORE_ROADS__) {
      map.addSource('core-roads-geo', { type: 'geojson', data: window.__IBB_CORE_ROADS__ });
      map.addLayer({
        id: 'core-roads-casing', type: 'line', source: 'core-roads-geo',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#94a3b8', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 8, 19, 16], 'line-opacity': 0.85 }
      }, 'buildings-3d-low');
      map.addLayer({
        id: 'core-roads-fill', type: 'line', source: 'core-roads-geo',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'class'], 'trunk', '#f59e0b', 'primary', '#fbbf24', 'secondary', '#fef08a', '#ffffff'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 5.5, 19, 12],
          'line-opacity': 0.92
        }
      }, 'buildings-3d-low');
    }
    if (window.__IBB_CORE_BLDS__) {
      map.addSource('core-blds-geo', { type: 'geojson', data: window.__IBB_CORE_BLDS__ });
      map.addLayer({
        id: 'core-blds-3d', type: 'fill-extrusion', source: 'core-blds-geo',
        minzoom: 13.5,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'h'], 10, '#cbd5e1', 18, '#94a3b8', 25, '#64748b'],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.88
        }
      });
    }

    // Bound 3D Building Highlight Layer (Point-in-Polygon Building Binding)
    map.addSource('bound-building', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'bound-building-3d', type: 'fill-extrusion', source: 'bound-building',
      paint: {
        'fill-extrusion-color': '#f59e0b',
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.88
      }
    });

    // Collision-Prioritized Commercial POIs Layer
    map.addSource('shard-pois', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'shard-pois-dots', type: 'circle', source: 'shard-pois', minzoom: 13.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13.5, 4, 18, 7],
        'circle-color': ['match', ['get', 'cat'],
          'hospital', '#ef4444', 'clinic', '#ef4444', 'pharmacy', '#f43f5e',
          'mosque', '#10b981', 'restaurant', '#f59e0b', 'cafe', '#f59e0b',
          'school', '#3b82f6', 'university', '#6366f1', 'bank', '#8b5cf6',
          'hotel', '#ec4899', 'gas', '#eab308', 'street', '#14b8a6', '#0ea5e9'],
        'circle-stroke-width': 1.6, 'circle-stroke-color': '#ffffff'
      }
    });
    map.addLayer({
      id: 'shard-pois-labels', type: 'symbol', source: 'shard-pois', minzoom: 14.5,
      layout: {
        'symbol-sort-key': ['get', 'priority'],
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 10.5, 18, 12.5],
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.9,
        'text-padding': 4,
        'icon-allow-overlap': false
      },
      paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 }
    });

    // User Field Contributions Layer
    map.addSource('user-pois', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'user-pois-dots', type: 'circle', source: 'user-pois',
      paint: { 'circle-radius': 7.5, 'circle-color': '#f59e0b', 'circle-stroke-width': 2, 'circle-stroke-color': '#0f172a' }
    });
    map.addLayer({
      id: 'user-pois-labels', type: 'symbol', source: 'user-pois',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
      paint: { 'text-color': '#b45309', 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 }
    });

    // Routing Polyline & Endpoints Layers
    map.addSource('route-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'route-line-casing', type: 'line', source: 'route-line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0284c7', 'line-width': 9, 'line-opacity': 0.55 }
    });
    map.addLayer({
      id: 'route-line-layer', type: 'line', source: 'route-line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#38bdf8', 'line-width': 5.5, 'line-opacity': 0.95 }
    });

    map.addSource('route-pts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'route-pts-layer', type: 'circle', source: 'route-pts',
      paint: { 'circle-radius': 7.5, 'circle-color': ['match', ['get', 'kind'], 'origin', '#10b981', '#ef4444'], 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff' }
    });

    refreshUserLayer();
    updatePoiLayers();
    updateRoutePoints();
    bootstrapDataPipelines();
    const c = map.getCenter();
    loadNearestShard(c.lat, c.lng);
    fetchSupabaseViewport(c.lat, c.lng, map.getZoom());
  });

  map.on('moveend zoomend', () => {
    const c = map.getCenter();
    const z = map.getZoom();
    document.getElementById('status-zoom').innerHTML = `الزوم: <strong style="color:#34d399;">${z.toFixed(1)}</strong> | محرك خريطتي 3D + Web Workers + IndexedDB`;
    document.getElementById('status-coords').textContent = `خط العرض: ${c.lat.toFixed(6)}° | خط الطول: ${c.lng.toFixed(6)}° | Plus Code: ${encodePlusCode(c.lat, c.lng)} | الارتفاع: ~2,040 م`;
    updatePoiLayers();
    if (z >= 14.0) loadNearestShard(c.lat, c.lng);
    fetchSupabaseViewport(c.lat, c.lng, z);
  });

  map.on('mousemove', (e) => {
    const { lat, lng } = e.lngLat;
    document.getElementById('status-coords').textContent = `خط العرض: ${lat.toFixed(6)}° | خط الطول: ${lng.toFixed(6)}° | Plus Code: ${encodePlusCode(lat, lng)} | الارتفاع: ~2,040 م`;
  });

  // 9. Place Details Card & Building Binding
  function showPlaceCard(props, lngLat) {
    const lat = +(lngLat?.lat ?? props.lat ?? 13.97265);
    const lng = +(lngLat?.lng ?? props.lng ?? 44.16155);
    const pcode = props.plusCode || encodePlusCode(lat, lng);
    lastSelectedPlace = {
      name: props.name || 'موقع في محافظة إب',
      cat: props.cat || 'shop',
      catAr: props.catAr || CAT_AR[props.cat] || props.basic_category || 'موقع / مبنى',
      reg: props.reg || 'محافظة إب',
      hara: props.hara || '',
      addr: props.addr || '',
      plusCode: pcode,
      floors: props.floors || (props.height ? Math.round(props.height / 3.2) : 5),
      elev: props.elev || 2042,
      rating: props.rating || 4.4,
      phone: props.phone || '',
      web: props.web || '',
      lat, lng
    };

    document.getElementById('pc-title').textContent = lastSelectedPlace.name;
    document.getElementById('pc-cat').textContent = `${lastSelectedPlace.catAr} • ⭐ ${lastSelectedPlace.rating}`;
    let meta = `<div><i class="fa-solid fa-location-dot" style="color:#10b981;"></i> النطاق: <strong>${lastSelectedPlace.reg}</strong> ${lastSelectedPlace.hara ? '— ' + lastSelectedPlace.hara : ''}</div>`;
    if (lastSelectedPlace.addr) meta += `<div><i class="fa-solid fa-Signs-post" style="color:#38bdf8;"></i> العنوان: ${lastSelectedPlace.addr}</div>`;
    if (lastSelectedPlace.phone) meta += `<div><i class="fa-solid fa-phone" style="color:#34d399;"></i> الهاتف: <a href="tel:${lastSelectedPlace.phone}">${lastSelectedPlace.phone}</a></div>`;
    meta += `<div><i class="fa-solid fa-building" style="color:#f59e0b;"></i> البثق الهندسي 3D: <strong>${lastSelectedPlace.floors} طوابق (~${Math.round(lastSelectedPlace.floors * 3.5)}م)</strong> • الارتفاع الجبلي: <strong>${lastSelectedPlace.elev} م</strong></div>`;

    document.getElementById('pc-meta').innerHTML = meta;
    document.getElementById('pc-coords-txt').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    document.getElementById('pc-pluscode').textContent = pcode;
    document.getElementById('place-card').classList.add('open');

    highlightBuildingForPlace(lastSelectedPlace);
  }

  document.getElementById('pc-highlight-bld').onclick = () => {
    if (!lastSelectedPlace) return;
    highlightBuildingForPlace(lastSelectedPlace);
    map.flyTo({ center: [lastSelectedPlace.lng, lastSelectedPlace.lat], zoom: 18.4, pitch: 60, bearing: -25 });
    showToast(`تم إضاءة المبنى المرتبط بـ "${lastSelectedPlace.name}"`);
  };

  document.getElementById('pc-copy').onclick = () => {
    if (!lastSelectedPlace) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?lat=${lastSelectedPlace.lat.toFixed(6)}&lng=${lastSelectedPlace.lng.toFixed(6)}&q=${encodeURIComponent(lastSelectedPlace.name)}`;
    const str = `${lastSelectedPlace.name} | ${lastSelectedPlace.hara || lastSelectedPlace.reg} | Plus Code: ${lastSelectedPlace.plusCode} | ${shareUrl}`;
    copyToClipboard(str);
    showToast('تم نسخ العنوان الرقمي ورمز Plus Code');
  };

  // Resolve a selected point against the live Ibb Market directory before opening its public place page.
document.getElementById('pc-open-store').onclick = async () => {
  if (!lastSelectedPlace) return;
  const p = lastSelectedPlace;
  const d = 0.00065;
  const params = new URLSearchParams({ bbox: [p.lng-d,p.lat-d,p.lng+d,p.lat+d].join(','), zoom: '18', limit: '50', q: p.name });
  showToast('جارٍ البحث عن صفحة المكان في دليل إب ماركت...');
  try {
    const response = await fetch('https://ibb-market-api.aicreativestudio.workers.dev/api/v1/map/places?' + params.toString(), { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error('MARKET_DIRECTORY_UNAVAILABLE');
    const data = await response.json();
    const norm = value => String(value || '').normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    const wanted = norm(p.name);
    const matches = (Array.isArray(data.items) ? data.items : []).filter(item => { const name = norm(item.name); return item.id && name && (name === wanted || name.includes(wanted) || wanted.includes(name)); }).map(item => { const lat=Number(item.latitude), lng=Number(item.longitude); return { item, distance: Number.isFinite(lat)&&Number.isFinite(lng) ? haversineKm(p.lat,p.lng,lat,lng) : Infinity }; }).filter(x => x.distance <= 0.12).sort((a,b) => a.distance-b.distance);
    if (!matches.length) { showToast('لم نعثر على صفحة منشورة مطابقة لهذا الموقع بعد. لم نفتح متجراً آخر بالخطأ.'); return; }
    window.location.href = '../market/place/?id=' + encodeURIComponent(matches[0].item.id);
  } catch (error) { showToast('تعذر الاتصال بدليل إب ماركت الآن. حاول مرة أخرى لاحقاً.'); }
};

  document.getElementById('pc-share-api').onclick = () => {
    if (!lastSelectedPlace) return;
    const payload = {
      event: 'IBB_PLACE_SELECTED',
      timestamp: new Date().toISOString(),
      place: lastSelectedPlace
    };
    window.parent.postMessage(payload, '*');
    copyToClipboard(JSON.stringify(payload, null, 2));
    showToast('تم بث حدث JSON عبر SDK ونسخ حمولة API للتطبيقات التجارية');
  };

  map.on('click', (e) => {
    if (pickMode === 'origin') {
      dirOrigin = { lat: e.lngLat.lat, lng: e.lngLat.lng, label: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}` };
      document.getElementById('dir-origin').value = dirOrigin.label;
      pickMode = null;
      updateRoutePoints();
      showToast('تم تحديد نقطة الانطلاق');
      return;
    }
    if (pickMode === 'dest') {
      dirDest = { lat: e.lngLat.lat, lng: e.lngLat.lng, label: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}` };
      document.getElementById('dir-dest').value = dirDest.label;
      pickMode = null;
      updateRoutePoints();
      showToast('تم تحديد الوجهة');
      return;
    }
    if (pickMode === 'contrib') {
      document.getElementById('cf-lat').value = e.lngLat.lat.toFixed(6);
      document.getElementById('cf-lng').value = e.lngLat.lng.toFixed(6);
      pickMode = null;
      document.getElementById('drawer').classList.add('open');
      showToast('تم التقاط الإحداثيات بنجاح');
      return;
    }

    const features = map.queryRenderedFeatures(e.point, {
      layers: ['user-pois-dots', 'user-pois-labels', 'shard-pois-dots', 'shard-pois-labels', 'ov-places-labels', 'ov-places-dots', 'settlement-labels', 'buildings-3d-high', 'buildings-3d-low']
    });
    if (features && features.length > 0) {
      showPlaceCard(features[0].properties || {}, e.lngLat);
    } else {
      const near = reverseGeocodeNearest(e.lngLat.lat, e.lngLat.lng);
      showPlaceCard({
        name: near ? `بالقرب من ${near.name}` : 'عنوان رقمي في محافظة إب',
        catAr: 'عنوان ذكي (Reverse Geocode)',
        reg: near?.reg || 'محافظة إب',
        hara: near?.hara || '',
        addr: near ? `على بُعد ${Math.round(near.distKm * 1000)} متر من ${near.name}` : ''
      }, e.lngLat);
    }
  });

  function reverseGeocodeNearest(lat, lng) {
    let best = null, bestD = 1e9;
    for (let i = 0; i < ALL_LOADED_POIS.length; i++) {
      const p = ALL_LOADED_POIS[i];
      const d = haversineKm(lat, lng, p.lat, p.lng);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { ...best, distKm: bestD } : null;
  }

  // 10. Instant Web Worker Search & Voice Search
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchMetaBar = document.getElementById('search-meta-bar');
  const clearBtn = document.getElementById('btn-clear-search');

  let supaSearchTimer = null;
  let supaSearchAbortController = null;
  const SUPA_SEARCH_CACHE = new Map();
  let searchRequestId = 0;

  function renderSearchResults(res) {
    searchMetaBar.classList.add('open');
    document.getElementById('search-time-txt').textContent = `${res.tookMs} ms • ${res.matches.length} نتيجة`;
    searchResults.innerHTML = '';
    if (res.matches.length === 0) {
      searchResults.innerHTML = `<div class="search-item"><div><div class="s-title">لا توجد نتائج مطابقة</div><div class="s-sub">جرّب البحث باسم الحارة أو الشارع أو رمز Plus Code</div></div></div>`;
    } else {
      res.matches.forEach(m => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.innerHTML = `
          <div>
            <div class="s-title">${m.name}</div>
            <div class="s-sub">${m.hara || m.reg} • ${m.plusCode} • بُعد ${m.distKm} كم</div>
          </div>
          <span class="s-tag">${m.catAr || m.cat}</span>
        `;
        div.onclick = () => {
          searchResults.classList.remove('open');
          map.flyTo({ center: [m.lng, m.lat], zoom: 18.2, pitch: is3D ? 55 : 0 });
          showPlaceCard(m, { lat: m.lat, lng: m.lng });
        };
        searchResults.appendChild(div);
      });
    }
    searchResults.classList.add('open');
  }

  async function runSearch() {
    const q = searchInput.value.trim();
    const requestId = ++searchRequestId;
    clearBtn.style.display = q ? 'block' : 'none';
    clearTimeout(supaSearchTimer);
    if (supaSearchAbortController) supaSearchAbortController.abort();

    if (q.length < 1) {
      searchResults.classList.remove('open');
      searchMetaBar.classList.remove('open');
      return;
    }
    const center = map.getCenter();
    const allowed = CAT_GROUPS[activeCatFilter];
    let res = await workerSearch(q, center.lat, center.lng, allowed, 25);
    if (requestId !== searchRequestId) return;
    renderSearchResults(res);

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || res.matches.length >= 6 || !navigator.onLine || q.length < 2) return;
    const cacheKey = `${q.toLocaleLowerCase()}|${activeCatFilter}|${center.lat.toFixed(2)}|${center.lng.toFixed(2)}`;
    const cached = SUPA_SEARCH_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      mergeCloudPois(cached.rows);
      const updated = await workerSearch(q, center.lat, center.lng, allowed, 25);
      if (requestId === searchRequestId && searchInput.value.trim() === q) renderSearchResults(updated);
      return;
    }

    supaSearchTimer = setTimeout(async () => {
      const controller = new AbortController();
      supaSearchAbortController = controller;
      try {
        const sr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_ibb_pois`, {
          method: 'POST',
          headers: SUPA_HEADERS,
          signal: controller.signal,
          body: JSON.stringify({ q_text: q, user_lat: center.lat, user_lng: center.lng, filter_cat: activeCatFilter || 'all', max_rows: LOW_DATA_MODE ? 10 : 15 })
        });
        if (!sr.ok) return;
        const rows = await sr.json();
        if (!Array.isArray(rows) || requestId !== searchRequestId || searchInput.value.trim() !== q) return;
        SUPA_SEARCH_CACHE.set(cacheKey, { at: Date.now(), rows });
        if (SUPA_SEARCH_CACHE.size > 60) SUPA_SEARCH_CACHE.delete(SUPA_SEARCH_CACHE.keys().next().value);
        mergeCloudPois(rows);
        const updated = await workerSearch(q, center.lat, center.lng, allowed, 25);
        if (requestId === searchRequestId && searchInput.value.trim() === q) renderSearchResults(updated);
      } catch (error) {
        if (error?.name !== 'AbortError') console.warn('Supabase search request failed', error);
      }
    }, LOW_DATA_MODE ? 800 : 500);
  }

  searchInput.addEventListener('input', runSearch);
  clearBtn.onclick = () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    searchResults.classList.remove('open');
    searchMetaBar.classList.remove('open');
  };

  document.getElementById('btn-voice-search').onclick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return showToast('المتصفح لا يدعم الإملاء الصوتي المباشر');
    const rec = new SR();
    rec.lang = 'ar-YE';
    rec.onstart = () => showToast('تحدث الآن للبحث في خريطة إب...');
    rec.onresult = (e) => {
      const txt = e.results[0][0].transcript;
      searchInput.value = txt;
      runSearch();
    };
    rec.start();
  };

  document.querySelectorAll('#chips-bar .chip-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#chips-bar .chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCatFilter = btn.getAttribute('data-cat');
      updatePoiLayers();
      if (searchInput.value.trim().length >= 1) runSearch();
      showToast(`تصفية الخريطة: ${btn.textContent.trim()}`);
    };
  });

  // 11. 100% Offline Local A* Routing Engine + Turn-by-Turn Arabic Voice Navigation
  function updateRoutePoints() {
    if (!map.getSource('route-pts')) return;
    const pts = [];
    if (dirOrigin) pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [dirOrigin.lng, dirOrigin.lat] }, properties: { kind: 'origin' } });
    if (dirDest) pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [dirDest.lng, dirDest.lat] }, properties: { kind: 'dest' } });
    map.getSource('route-pts').setData({ type: 'FeatureCollection', features: pts });
  }

  async function calculateRoute() {
    if (!dirOrigin || !dirDest) return showToast('يرجى تحديد نقطة الانطلاق والوجهة أولاً');
    const sumEl = document.getElementById('dir-summary');
    sumEl.style.display = 'block';
    sumEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري حساب المسار عبر محرك A* المحلي...';

    // 1st Priority: 100% Local Offline A* Road Graph Worker (< 5ms)
    let routeRes = await workerRoute(dirOrigin.lat, dirOrigin.lng, dirDest.lat, dirDest.lng, dirProfile);

    if (!routeRes) {
      sumEl.textContent = 'لا يتوفر مسار صالح في شبكة الطرق لهذه الوجهة. اختر نقطتين متصلتين بالطرق أو تحقق من بيانات التوجيه.';
      showToast('تعذر إيجاد مسار على شبكة الطرق؛ لم يتم رسم خط مستقيم بديل.');
      return;
    }

    lastComputedRoute = routeRes;
    if (map.getSource('route-line')) {
      map.getSource('route-line').setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: routeRes.geometry, properties: {} }]
      });
    }
    updateRoutePoints();

    const bounds = new maplibregl.LngLatBounds([dirOrigin.lng, dirOrigin.lat], [dirOrigin.lng, dirOrigin.lat]);
    routeRes.geometry.coordinates.forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: 75, pitch: 45 });

    const km = routeRes.distanceMeters / 1000;
    const distTxt = km < 1 ? `${routeRes.distanceMeters} متر` : `${km.toFixed(2)} كم`;
    const mins = Math.max(1, Math.round(routeRes.durationSeconds / 60));
    const timeTxt = mins >= 60 ? `${Math.floor(mins / 60)} س ${mins % 60} د` : `${mins} دقيقة`;
    const deliveryFee = Math.max(500, Math.round((400 + km * 250) / 50) * 50);

    const stepsHtml = (routeRes.steps || []).map((s, idx) => `
      <div class="step-row">
        <span><strong>${idx + 1}.</strong> ${s.text}</span>
      </div>
    `).join('');

    sumEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-weight:800; color:#34d399; font-size:0.88rem;">
        <span><i class="fa-solid fa-clock"></i> ${timeTxt}</span>
        <span><i class="fa-solid fa-road"></i> ${distTxt}</span>
        <span style="color:#fbbf24;"><i class="fa-solid fa-motorcycle"></i> توصيل: ~${deliveryFee} ر.ي</span>
      </div>
      <div style="font-size:0.71rem; color:#38bdf8; margin-top:4px;">
        ${routeRes.engine} • زمن الحساب: ${routeRes.computeMs} ms • العقد المفحوصة: ${routeRes.exploredNodes}
      </div>
      <div class="steps-list">${stepsHtml}</div>
    `;
  }

  document.getElementById('dir-voice-tts').onclick = () => {
    if (!lastComputedRoute || !lastComputedRoute.steps) return showToast('احسب المسار أولاً لتشغيل التوجيه الصوتي');
    if (!('speechSynthesis' in window)) return showToast('النطق الصوتي غير مدعوم في هذا المتصفح');
    window.speechSynthesis.cancel();
    const text = lastComputedRoute.steps.map(s => s.text).join('. ثم ');
    const utter = new SpeechSynthesisUtterance(`مسارك في مدينة إب جاهز. ${text}`);
    utter.lang = 'ar-SA';
    window.speechSynthesis.speak(utter);
    showToast('جاري قراءة تعليمات الملاحة خطوة بخطوة بالعربية');
  };

  document.querySelectorAll('.dir-mode-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.dir-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      dirProfile = btn.getAttribute('data-profile');
      if (dirOrigin && dirDest) calculateRoute();
    };
  });
  document.getElementById('dir-pick-origin').onclick = () => { pickMode = 'origin'; showToast('انقر على الخريطة لتحديد نقطة الانطلاق'); };
  document.getElementById('dir-pick-dest').onclick = () => { pickMode = 'dest'; showToast('انقر على الخريطة لتحديد الوجهة'); };
  document.getElementById('dir-use-gps').onclick = () => {
    if (!navigator.geolocation) return showToast('GPS غير مدعوم');
    navigator.geolocation.getCurrentPosition(p => {
      dirOrigin = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'موقعي الحالي (GPS)' };
      document.getElementById('dir-origin').value = dirOrigin.label;
      updateRoutePoints();
    }, () => showToast('تعذر جلب إحداثيات GPS'));
  };
  document.getElementById('dir-calc').onclick = calculateRoute;
  document.getElementById('dir-clear').onclick = () => {
    dirOrigin = null; dirDest = null;
    document.getElementById('dir-origin').value = '';
    document.getElementById('dir-dest').value = '';
    document.getElementById('dir-summary').style.display = 'none';
    if (map.getSource('route-line')) map.getSource('route-line').setData({ type: 'FeatureCollection', features: [] });
    updateRoutePoints();
  };

  function openDirections() {
    document.getElementById('place-card').classList.remove('open');
    document.getElementById('sv-panel').classList.remove('open');
    document.getElementById('dir-panel').classList.add('open');
  }
  document.getElementById('btn-open-directions').onclick = openDirections;
  document.getElementById('qa-directions').onclick = () => { openDirections(); calculateRoute(); };
  document.getElementById('dir-close').onclick = () => document.getElementById('dir-panel').classList.remove('open');

  document.getElementById('pc-route-to').onclick = () => {
    if (!lastSelectedPlace) return;
    dirDest = { lat: lastSelectedPlace.lat, lng: lastSelectedPlace.lng, label: lastSelectedPlace.name };
    document.getElementById('dir-dest').value = dirDest.label;
    openDirections();
    calculateRoute();
  };
  document.getElementById('pc-route-from').onclick = () => {
    if (!lastSelectedPlace) return;
    dirOrigin = { lat: lastSelectedPlace.lat, lng: lastSelectedPlace.lng, label: lastSelectedPlace.name };
    document.getElementById('dir-origin').value = dirOrigin.label;
    openDirections();
    updateRoutePoints();
  };

  // 12. 360° Street-Level & Storefront Viewer
  let currentSvHeading = 110;
  let isDraggingSv = false;
  let svStartX = 0;

  function openStreetViewNode(node) {
    document.getElementById('place-card').classList.remove('open');
    document.getElementById('dir-panel').classList.remove('open');
    document.getElementById('sv-panel').classList.add('open');

    const strip = document.getElementById('sv-strip');
    strip.style.backgroundImage = `url("${node.img}")`;
    document.getElementById('sv-title').textContent = node.title;
    document.getElementById('sv-sub').textContent = node.sub;
    currentSvHeading = node.heading;
    updateSvTransform();

    const navLinksHtml = (node.links || []).map(lk =>
      `<button class="chip-btn sv-nav-link" data-svid="${lk.id}" style="margin:4px 3px; background:rgba(56,189,248,0.18); border-color:#38bdf8; color:#e0f2fe;"><i class="fa-solid fa-route"></i> ${lk.label}</button>`
    ).join('');
    document.getElementById('sv-nearby-shops').innerHTML =
      (navLinksHtml ? `<div style="margin-bottom:6px;">${navLinksHtml}</div>` : '') +
      `<strong><i class="fa-solid fa-store" style="color:#34d399;"></i> الواجهات التجارية المرتبطة بهذه النقطة:</strong><br/>` +
      node.shops.map(s => `<span style="display:inline-block; background:rgba(16,185,129,0.14); color:#34d399; padding:2px 7px; border-radius:6px; margin:3px 2px;">${s}</span>`).join('');
    document.querySelectorAll('.sv-nav-link').forEach(btn => {
      btn.onclick = () => {
        const target = STREETVIEW_NODES.find(x => x.id === btn.dataset.svid);
        if (target) openStreetViewNode(target);
      };
    });

    map.flyTo({ center: [node.lng, node.lat], zoom: 17.8, pitch: 60, bearing: node.heading - 180 });
  }

  function updateSvTransform() {
    const pct = ((currentSvHeading % 360) + 360) % 360 / 360 * 50;
    document.getElementById('sv-strip').style.transform = `translateX(${pct}%)`;
    document.getElementById('sv-heading-txt').textContent = `الاتجاه: ${Math.round(((currentSvHeading % 360) + 360) % 360)}°`;
  }

  const svBox = document.getElementById('sv-viewer-box');
  svBox.addEventListener('pointerdown', (e) => { isDraggingSv = true; svStartX = e.clientX; });
  window.addEventListener('pointermove', (e) => {
    if (!isDraggingSv) return;
    const dx = e.clientX - svStartX;
    svStartX = e.clientX;
    currentSvHeading -= dx * 0.45;
    updateSvTransform();
  });
  window.addEventListener('pointerup', () => { isDraggingSv = false; });

  const svBar = document.getElementById('sv-nodes-bar');
  STREETVIEW_NODES.forEach(n => {
    const b = document.createElement('button');
    b.className = 'chip-btn';
    b.innerHTML = `<i class="fa-solid fa-camera"></i> ${n.title.split('—')[0].trim()}`;
    b.onclick = () => openStreetViewNode(n);
    svBar.appendChild(b);
  });

  document.getElementById('qa-streetview').onclick = () => openStreetViewNode(STREETVIEW_NODES[0]);
  document.getElementById('pc-streetview').onclick = () => {
    if (!lastSelectedPlace) return openStreetViewNode(STREETVIEW_NODES[0]);
    let best = STREETVIEW_NODES[0], bestD = 1e9;
    STREETVIEW_NODES.forEach(n => {
      const d = haversineKm(lastSelectedPlace.lat, lastSelectedPlace.lng, n.lat, n.lng);
      if (d < bestD) { bestD = d; best = n; }
    });
    openStreetViewNode(best);
  };
  document.getElementById('sv-close').onclick = () => document.getElementById('sv-panel').classList.remove('open');

  // 13. Conversational Geo-RAG Assistant
  async function runGeoRagQuery(queryText) {
    const q = (queryText || document.getElementById('rag-input').value || '').trim();
    if (!q) return showToast('اكتب سؤالك الجغرافي أولاً');
    document.getElementById('rag-input').value = q;
    const out = document.getElementById('rag-output');
    out.innerHTML = '<div style="font-size:0.78rem; color:#38bdf8;"><i class="fa-solid fa-spinner fa-spin"></i> جاري الفحص المكاني واستخراج السجلات الموثقة...</div>';

    // Detect category intent from Arabic query
    let cats = null;
    if (q.includes('مستشفى') || q.includes('طبي') || q.includes('عيادة')) cats = ['hospital', 'clinic'];
    else if (q.includes('صيدلي')) cats = ['pharmacy'];
    else if (q.includes('فندق') || q.includes('استراح')) cats = ['hotel'];
    else if (q.includes('بنك') || q.includes('صراف')) cats = ['bank'];
    else if (q.includes('مطعم') || q.includes('كافي')) cats = ['restaurant', 'cafe'];
    else if (q.includes('زغط') || q.includes('شارع') || q.includes('جولة')) cats = ['street'];

    const c = map.getCenter();
    const cleanQ = q.replace(/أقرب|افضل|أفضل|في|بـ|من|إلى|شارع|حي|مديرية/g, ' ').trim();
    const res = await workerSearch(cleanQ, c.lat, c.lng, cats, 6);
    const matches = res.matches.length > 0 ? res.matches : (await workerSearch('', c.lat, c.lng, cats, 6)).matches;

    let html = `
      <div style="background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); border-radius:10px; padding:9px; font-size:0.77rem;">
        تم استرجاع <strong>${matches.length}</strong> مواقع موثقة من الفهرس المكاني لمدينة إب في <strong>${res.tookMs} ms</strong>:
      </div>
    `;
    matches.forEach((m) => {
      html += `
        <div class="offline-item" style="flex-direction:column; align-items:stretch;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h4>${m.name}</h4>
            <span class="r-badge">${m.distKm} كم • ⭐ ${m.rating || 4.4}</span>
          </div>
          <p>${m.catAr} • ${m.hara || m.reg} • Plus Code: <strong>${m.plusCode}</strong> ${m.phone ? '• 📞 ' + m.phone : ''}</p>
          <div style="display:flex; gap:6px; margin-top:6px;">
            <button class="btn-action primary rag-fly" data-lat="${m.lat}" data-lng="${m.lng}" data-name="${m.name}" style="flex:1; padding:5px;">عرض على الخريطة 3D</button>
            <button class="btn-action rag-route" data-lat="${m.lat}" data-lng="${m.lng}" data-name="${m.name}" style="flex:1; padding:5px;">رسم المسار A*</button>
          </div>
        </div>
      `;
    });
    out.innerHTML = html;

    out.querySelectorAll('.rag-fly').forEach(b => {
      b.onclick = () => {
        const lat = +b.dataset.lat, lng = +b.dataset.lng;
        map.flyTo({ center: [lng, lat], zoom: 18.2, pitch: 56 });
        showPlaceCard({ name: b.dataset.name, lat, lng }, { lat, lng });
      };
    });
    out.querySelectorAll('.rag-route').forEach(b => {
      b.onclick = () => {
        dirDest = { lat: +b.dataset.lat, lng: +b.dataset.lng, label: b.dataset.name };
        document.getElementById('dir-dest').value = dirDest.label;
        openDirections();
        calculateRoute();
      };
    });
  }

  document.getElementById('rag-send').onclick = () => runGeoRagQuery();
  document.querySelectorAll('.rag-preset').forEach(b => {
    b.onclick = () => runGeoRagQuery(b.getAttribute('data-q'));
  });

  // 14. Offline District Downloader & IndexedDB Cache Manager
  const OFFLINE_KEY = 'ibb_offline_packs_v3';
  function getOfflineState() { return safeGetStorage(OFFLINE_KEY, '{}'); }
  function setOfflineState(obj) { safeSetStorage(OFFLINE_KEY, obj); }

  async function downloadUrlsToCache(packId, urls, btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
    try {
      if ('caches' in window) {
        const cache = await caches.open('my-ibb-map-v3');
        for (const u of urls) {
          try {
            const res = await fetch(u);
            if (res.ok) await cache.put(u, res);
          } catch {}
        }
      }
      // Also warm up IndexedDB Byte Range cache if PMTiles
      for (const u of urls) {
        if (u.endsWith('.pmtiles')) {
          const src = new IndexedDBByteSource(u);
          await src.getBytes(0, 16384).catch(() => {});
        }
      }
      const st = getOfflineState();
      st[packId] = Date.now();
      setOfflineState(st);
      renderOfflineManager();
      showToast('تم حفظ الحزمة في IndexedDB وCacheStorage للعمل بدون إنترنت');
    } catch {
      btnEl.disabled = false;
      btnEl.innerHTML = '<i class="fa-solid fa-download"></i> إعادة المحاولة';
    }
  }

  function renderOfflineManager() {
    const st = getOfflineState();
    const packsEl = document.getElementById('offline-packs');
    const corePacks = [
      {
        id: 'ROUTING_AND_SEARCH_PACK',
        title: 'حزمة التوجيه المحلي A* + فهرس البحث (850 KB)',
        desc: 'شبكة طرق محافظة إب الموجهة (ibb_routing_graph.json) + الفهرس الكروي للعمل 100% بدون إنترنت',
        urls: ['./data/ibb_routing_graph.json', './data/core_lite.json', './data/core_index.json']
      },
      {
        id: 'VECTOR_BASE_PACK',
        title: 'حزمة الطبقات المتجهة الأساسية (PMTiles)',
        desc: 'حدود المحافظة والمديريات والقرى والمعالم الرئيسية في IndexedDB',
        urls: ['./pmtiles/governorate.pmtiles', './pmtiles/districts.pmtiles', './pmtiles/places.pmtiles', './pmtiles/base.pmtiles']
      }
    ];

    packsEl.innerHTML = '';
    corePacks.forEach(p => {
      const done = Boolean(st[p.id]);
      const div = document.createElement('div');
      div.className = 'offline-item';
      div.innerHTML = `
        <div><h4>${p.title}</h4><p>${p.desc}</p></div>
        <button class="btn-action ${done ? '' : 'primary'}" style="padding:6px 10px; white-space:nowrap;">
          ${done ? '<i class="fa-solid fa-check" style="color:#34d399;"></i> محفوظ' : '<i class="fa-solid fa-download"></i> تنزيل'}
        </button>
      `;
      div.querySelector('button').onclick = (e) => downloadUrlsToCache(p.id, p.urls, e.currentTarget);
      packsEl.appendChild(div);
    });

    const regEl = document.getElementById('offline-regions-list');
    regEl.innerHTML = '';
    REGIONS.forEach(r => {
      const done = Boolean(st[r.code]);
      const div = document.createElement('div');
      div.className = 'offline-item';
      div.innerHTML = `
        <div><h4>${r.name_ar}</h4><p>${r.code} • ${r.kb} KB</p></div>
        <button class="btn-action ${done ? '' : 'primary'}" style="padding:5px 10px; white-space:nowrap;">
          ${done ? '<i class="fa-solid fa-check" style="color:#34d399;"></i> متاح أوفلاين' : '<i class="fa-solid fa-download"></i> حفظ'}
        </button>
      `;
      div.querySelector('button').onclick = (e) => downloadUrlsToCache(r.code, [`./data/shards/${r.code}.json`], e.currentTarget);
      regEl.appendChild(div);
    });
  }

  // 15. Field Contributions & Commercial Directory Admin
  const CONTRIB_KEY = 'ibb_field_contributions_v1';
  function getContribs() { return safeGetStorage(CONTRIB_KEY, '[]'); }
  function saveContribs(list) {
    safeSetStorage(CONTRIB_KEY, list);
    refreshUserLayer();
    renderContribList();
  }

  function refreshUserLayer() {
    if (!map.getSource('user-pois')) return;
    const list = getContribs();
    map.getSource('user-pois').setData({
      type: 'FeatureCollection',
      features: list.map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(c.lng), Number(c.lat)] },
        properties: { id: c.id, name: c.name, cat: c.cat, catAr: CAT_AR[c.cat] || c.cat, hara: c.hara || '', phone: c.phone || '', addr: c.notes || '', src: 'توثيق ميداني خاص' }
      }))
    });
  }

  function renderContribList() {
    const list = getContribs();
    document.getElementById('contrib-count').textContent = list.length;
    const container = document.getElementById('contrib-list');
    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = '<p style="font-size:0.76rem; color:#94a3b8;">لا توجد سجلات مضافة يدوياً بعد.</p>';
      return;
    }
    list.forEach((c, idx) => {
      const div = document.createElement('div');
      div.className = 'offline-item';
      div.innerHTML = `
        <div style="cursor:pointer;" class="c-jump">
          <h4>${c.name}</h4>
          <p>${CAT_AR[c.cat] || c.cat} • ${c.hara || 'إب'} • ${Number(c.lat).toFixed(4)}, ${Number(c.lng).toFixed(4)}</p>
        </div>
        <button class="icon-btn c-del" title="حذف"><i class="fa-solid fa-trash" style="color:#ef4444;"></i></button>
      `;
      div.querySelector('.c-jump').onclick = () => {
        map.flyTo({ center: [Number(c.lng), Number(c.lat)], zoom: 18.2 });
        showPlaceCard(c, { lat: Number(c.lat), lng: Number(c.lng) });
      };
      div.querySelector('.c-del').onclick = () => {
        const next = getContribs();
        next.splice(idx, 1);
        saveContribs(next);
        showToast('تم حذف السجل');
      };
      container.appendChild(div);
    });
  }

  document.getElementById('cf-pick-map').onclick = () => {
    pickMode = 'contrib';
    document.getElementById('drawer').classList.remove('open');
    showToast('انقر على الخريطة لالتقاط إحداثيات المنشأة');
  };

  document.getElementById('contrib-form').onsubmit = (e) => {
    e.preventDefault();
    const list = getContribs();
    const item = {
      id: document.getElementById('cf-id').value || 'u_' + Date.now(),
      name: document.getElementById('cf-name').value.trim(),
      cat: document.getElementById('cf-cat').value,
      hara: document.getElementById('cf-hara').value.trim(),
      lat: parseFloat(document.getElementById('cf-lat').value),
      lng: parseFloat(document.getElementById('cf-lng').value),
      phone: document.getElementById('cf-phone').value.trim(),
      notes: document.getElementById('cf-notes').value.trim(),
      updatedAt: new Date().toISOString()
    };
    const existingIdx = list.findIndex(x => x.id === item.id);
    if (existingIdx >= 0) list[existingIdx] = item;
    else list.unshift(item);

    saveContribs(list);
    saveContributionToSupabase(item);
    const enrichedItem = { name: item.name, cat: item.cat, catAr: CAT_AR[item.cat] || item.cat, lat: item.lat, lng: item.lng, reg: 'توثيق ميداني', hara: item.hara, addr: item.notes, phone: item.phone };
    ALL_LOADED_POIS.unshift(enrichedItem);
    searchWorker.postMessage({ type: 'ADD_ITEMS', payload: [enrichedItem] });
    updatePoiLayers();
    e.target.reset();
    document.getElementById('cf-id').value = '';
    showToast('تم حفظ وتوثيق المنشأة في قاعدة البيانات بنجاح');
  };

  document.getElementById('pc-edit').onclick = () => {
    if (!lastSelectedPlace) return;
    document.getElementById('cf-name').value = lastSelectedPlace.name;
    document.getElementById('cf-hara').value = lastSelectedPlace.hara || '';
    document.getElementById('cf-lat').value = lastSelectedPlace.lat.toFixed(6);
    document.getElementById('cf-lng').value = lastSelectedPlace.lng.toFixed(6);
    document.getElementById('cf-phone').value = lastSelectedPlace.phone || '';
    document.getElementById('cf-notes').value = lastSelectedPlace.addr || '';
    openDrawerTab('tab-contrib');
  };

  function downloadBlob(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  document.getElementById('btn-export-geojson').onclick = () => {
    const list = [...getContribs(), ...ALL_LOADED_POIS.slice(0, 500)];
    const fc = {
      type: 'FeatureCollection',
      metadata: { generator: 'Ibb GeoPlatform Enterprise v3.0', count: list.length },
      features: list.map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(c.lng), Number(c.lat)] },
        properties: { name: c.name, category: c.cat, hara: c.hara || '', phone: c.phone || '', plusCode: c.plusCode || encodePlusCode(+c.lat, +c.lng) }
      }))
    };
    downloadBlob('ibb_commercial_directory.geojson', JSON.stringify(fc, null, 2), 'application/geo+json');
  };

  document.getElementById('btn-export-json').onclick = () => {
    downloadBlob('ibb_field_contributions.json', JSON.stringify(getContribs(), null, 2), 'application/json');
  };

  // Commercial SDK Portal Actions
  document.getElementById('btn-test-sdk').onclick = async () => {
    const out = document.getElementById('sdk-test-output');
    out.style.display = 'block';
    out.textContent = 'جاري تنفيذ استعلام SDK التجاري...';
    const r = await window.IbbMapSDK.calculateDeliveryRoute(
      { lat: 13.97265, lng: 44.16155 },
      { lat: 13.96541, lng: 44.18173 },
      'driving'
    );
    const rev = window.IbbMapSDK.reverseGeocode(13.97415, 44.17480);
    out.textContent = JSON.stringify({
      sdkVersion: window.IbbMapSDK.version,
      deliveryRoute: {
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
        estimatedDeliveryFeeYER: r.estimatedDeliveryFeeYER,
        computeMs: r.computeMs
      },
      reverseGeocodeSample: rev
    }, null, 2);
    showToast('تم تنفيذ اختبار IbbMapSDK بنجاح');
  };

  document.getElementById('btn-copy-sdk').onclick = () => {
    copyToClipboard(document.getElementById('sdk-code-iframe').textContent);
    showToast('تم نسخ كود التضمين التجاري SDK');
  };

  document.getElementById('btn-dl-routing-graph').onclick = async () => {
    const g = await fetchJsonWithFallback('./data/ibb_routing_graph.json');
    downloadBlob('ibb_routing_graph.json', JSON.stringify(g || { nodes: [] }), 'application/json');
  };

  document.getElementById('btn-dl-all-csv').onclick = () => {
    const headers = ['Name', 'Category', 'District', 'Neighborhood', 'PlusCode', 'Latitude', 'Longitude', 'Elevation_m', 'Floors', 'Rating', 'Phone'];
    const rows = ALL_LOADED_POIS.slice(0, 5000).map(p => [
      `"${(p.name || '').replace(/"/g, '""')}"`, `"${p.catAr || p.cat}"`, `"${p.reg || ''}"`, `"${p.hara || ''}"`,
      p.plusCode || encodePlusCode(p.lat, p.lng), p.lat, p.lng, p.elev || 2040, p.floors || 4, p.rating || 4.3, `"${p.phone || ''}"`
    ]);
    const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadBlob('ibb_commercial_establishments.csv', csv, 'text/csv;charset=utf-8');
  };

  // 16. Drawer Navigation, Modes, 3D Terrain & Camera Controls
  function openDrawerTab(tabId) {
    document.getElementById('drawer').classList.add('open');
    document.querySelectorAll('.d-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tabId));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
  }

  document.querySelectorAll('.d-tab').forEach(tab => {
    tab.onclick = () => openDrawerTab(tab.getAttribute('data-tab'));
  });
  document.getElementById('btn-open-drawer').onclick = () => openDrawerTab('tab-regions');
  document.getElementById('qa-georag').onclick = () => { openDrawerTab('tab-georag'); runGeoRagQuery('مستشفى في الظهار'); };
  document.getElementById('qa-sdk').onclick = () => openDrawerTab('tab-sdk');
  document.getElementById('qa-offline').onclick = () => openDrawerTab('tab-offline');
  document.getElementById('btn-close-drawer').onclick = () => document.getElementById('drawer').classList.remove('open');

  function set3DTerrain(enabled) {
    isTerrain = enabled;
    document.getElementById('chk-terrain').checked = enabled;
    document.getElementById('btn-toggle-terrain').classList.toggle('active', enabled);
    if (map.getLayer('terrain-hillshade')) {
      map.setLayoutProperty('terrain-hillshade', 'visibility', enabled ? 'visible' : 'none');
    }
    try {
      map.setTerrain(enabled ? { source: 'ibb_terrain_dem', exaggeration: 1.28 } : null);
    } catch {}
    showToast(enabled ? 'تم تفعيل التضاريس الجبلية الثلاثية الأبعاد (DEM 1.28x)' : 'تم إيقاف التضاريس الجبلية');
  }

  document.getElementById('btn-toggle-terrain').onclick = () => set3DTerrain(!isTerrain);
  document.getElementById('chk-terrain').onchange = function() { set3DTerrain(this.checked); };

  // Switch Proprietary Map Modes (PertileService GPU Restyling)
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-mode');

      map.setLayoutProperty('raster-sat', 'visibility', mode === 'sat_3d' ? 'visible' : 'none');
      if (mode === 'terrain_3d' && !isTerrain) set3DTerrain(true);

      const isDark = (mode === 'dark_3d' || mode === 'sat_3d');
      map.setPaintProperty('bg', 'background-color', mode === 'dark_3d' ? '#090f1d' : (mode === 'terrain_3d' ? '#ecfdf5' : '#f1f5f9'));
      map.setLayoutProperty('landuse-fill', 'visibility', mode === 'sat_3d' ? 'none' : 'visible');
      map.setLayoutProperty('water-fill', 'visibility', mode === 'sat_3d' ? 'none' : 'visible');

      const bldOp = mode === 'sat_3d' ? 0.52 : 0.92;
      map.setPaintProperty('buildings-3d-low', 'fill-extrusion-opacity', bldOp);
      map.setPaintProperty('buildings-3d-high', 'fill-extrusion-opacity', bldOp);

      const txtCol = isDark ? '#f8fafc' : '#0f172a';
      const haloCol = isDark ? '#020617' : '#ffffff';
      ['ov-places-labels', 'road-labels', 'shard-pois-labels'].forEach(lid => {
        if (map.getLayer(lid)) {
          map.setPaintProperty(lid, 'text-color', txtCol);
          map.setPaintProperty(lid, 'text-halo-color', haloCol);
        }
      });
    };
  });

  document.getElementById('chk-3d').onchange = function() {
    const v = this.checked ? 'visible' : 'none';
    map.setLayoutProperty('buildings-3d-low', 'visibility', v);
    map.setLayoutProperty('buildings-3d-high', 'visibility', v);
  };
  document.getElementById('chk-roads').onchange = function() {
    const v = this.checked ? 'visible' : 'none';
    map.setLayoutProperty('roads-casing', 'visibility', v);
    map.setLayoutProperty('roads-fill', 'visibility', v);
  };
  document.getElementById('chk-pois').onchange = function() {
    const v = this.checked ? 'visible' : 'none';
    if (map.getLayer('shard-pois-dots')) map.setLayoutProperty('shard-pois-dots', 'visibility', v);
    if (map.getLayer('shard-pois-labels')) map.setLayoutProperty('shard-pois-labels', 'visibility', v);
  };
  document.getElementById('chk-labels').onchange = function() {
    const v = this.checked ? 'visible' : 'none';
    ['road-labels', 'district-labels', 'settlement-labels', 'ov-places-dots', 'ov-places-labels'].forEach(l => map.setLayoutProperty(l, 'visibility', v));
  };

  document.getElementById('btn-toggle-3d').onclick = function() {
    is3D = !is3D;
    this.classList.toggle('active', is3D);
    map.easeTo({ pitch: is3D ? 54 : 0, bearing: is3D ? -16 : 0, duration: 500 });
  };
  document.getElementById('btn-z19').onclick = () => map.easeTo({ zoom: 19, pitch: is3D ? 58 : 0 });
  document.getElementById('btn-plus').onclick = () => map.zoomIn();
  document.getElementById('btn-minus').onclick = () => map.zoomOut();
  document.getElementById('btn-home').onclick = () => map.flyTo({ center: [44.1680, 13.9715], zoom: 16.2, pitch: 54, bearing: -16 });
  document.getElementById('pc-close').onclick = () => document.getElementById('place-card').classList.remove('open');

  document.getElementById('btn-gps').onclick = () => {
    if (!navigator.geolocation) return showToast('GPS غير مدعوم');
    navigator.geolocation.getCurrentPosition(p => {
      map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 18, pitch: is3D ? 54 : 0 });
    }, () => showToast('تعذر جلب موقع GPS'));
  };

  // Populate Region Jump List
  const rList = document.getElementById('region-list');
  REGIONS.forEach(r => {
    const item = document.createElement('div');
    item.className = 'region-item';
    item.innerHTML = `<div><h4>${r.name_ar}</h4><p>${r.name_en} — ${r.code}</p></div><span class="r-badge">Z${r.zoom}</span>`;
    item.onclick = () => {
      map.flyTo({ center: [r.lng, r.lat], zoom: r.zoom, pitch: is3D ? 54 : 0 });
      if (window.innerWidth < 640) document.getElementById('drawer').classList.remove('open');
    };
    rList.appendChild(item);
  });

  // Expose Public API Hook for IbbMapSDK
  window.IbbPlatformApp = {
    search: (q, opts = {}) => workerSearch(q, opts.lat ?? 13.97265, opts.lng ?? 44.16155, opts.cats ?? null, opts.limit ?? 20),
    route: (orig, dest, mode = 'driving') => workerRoute(orig.lat, orig.lng, dest.lat, dest.lng, mode),
    reverseGeocode: (lat, lng) => {
      const near = reverseGeocodeNearest(lat, lng);
      return { plusCode: encodePlusCode(lat, lng), nearestPlace: near };
    },
    flyTo: (lat, lng, zoom = 18) => map.flyTo({ center: [lng, lat], zoom, pitch: is3D ? 54 : 0 })
  };

  renderOfflineManager();
  renderContribList();

  // Deep-Link Support (?lat=...&lng=...&q=...)
  try {
    const usp = new URLSearchParams(window.location.search);
    const dLat = parseFloat(usp.get('lat')), dLng = parseFloat(usp.get('lng'));
    const dQ = usp.get('q');
    if (!isNaN(dLat) && !isNaN(dLng)) {
      setTimeout(() => {
        map.flyTo({ center: [dLng, dLat], zoom: 18.0, pitch: is3D ? 55 : 0 });
        showPlaceCard({ name: dQ || 'موقع مشترك', catAr: 'رابط مشاركة مباشر' }, { lat: dLat, lng: dLng });
      }, 400);
    }
  } catch {}
})();

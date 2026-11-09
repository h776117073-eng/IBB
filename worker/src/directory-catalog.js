import { paymentReadiness, constantTimeEqual } from "./payments/adapter.js";

const API_VERSION = "2";
const KINDS = new Set(["BUSINESS", "LANDMARK", "STREET", "NEIGHBORHOOD", "PUBLIC_SERVICE", "OTHER"]);

export function normalizeText(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseBbox(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) return null;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west >= east || south >= north) return null;
  if (east - west > 1.6 || north - south > 1.6) return null;
  return { west, south, east, north };
}

export function clusterStep(zoom) {
  if (zoom <= 10) return 0.04;
  if (zoom <= 12) return 0.015;
  if (zoom <= 14) return 0.005;
  return 0;
}

export function classifyEntityKind(name, category = "", sourceCategory = "") {
  const nameText = normalizeText(name);
  const categoryText = normalizeText(category);
  const sourceText = normalizeText(sourceCategory);

  const businessPattern = /(نشاط تجاري|محل|متجر|مؤسسة|شركة|مطعم|بقالة|صيدلية|مخبز|معرض|ورشة|مركز تجاري|ملابس|جوالات|إلكترونيات|قطع غيار|تاجر|وكالة|فندق|بنك|مقهى|مطبعة|حلاق|تجميل|مورد|سوبرماركت|سوق|store|shop|market|restaurant|cafe|coffee|bank|agency|dealer|repair|wholesaler|supplier|salon|hotel|pharmacy|bakery|grocery|supermarket|butcher|printer|hardware|parts|furniture|electronics|cell phone|mobile|clothing|shoe|jewelry|travel|amusement|barber|beauty|advertising|business center|call center|camera|candy|cattle|boat tour|brunch|buffet|fast food|car wash|car rental|car leasing|car detailing|chicken|cake|cafeteria|barbecue|book store|boot store|bridal|clothes|structural engineer|radio broadcaster)/i;
  const publicServicePattern = /(مكتبة عامة|مستشفى|مركز صحي|مستوصف|مدرسة|جامعة|كلية|مكتب حكومي|مركز شرطة|مرفق عام|hospital|clinic|school|university|college|library|government office|public service|police station|bus stop|transit stop|non-governmental organization)/i;
  const landmarkPattern = /(جامع|مسجد|مقبرة|مزار|متحف|حديقة|منتزه|ساحة عامة|قلعة|حصن|أثر|جسر|park|garden|bridge|museum|historical landmark|tourist attraction|place of worship|monument|theme park|botanical garden)/i;
  const neighborhoodPattern = /(حارة|حي\s|منطقة سكنية|قرية|عزلة|محلة|neighborhood|district|suburb|village|locality|residential area)/i;
  const streetPattern = /(شارع|طريق|نفق|دوار|تقاطع|جولة|ميدان|street|road|route|highway|intersection|roundabout)/i;

  // Google Maps' source category is stronger evidence than a translated display label.
  if (sourceText === "apartment building") return "OTHER";
  if (businessPattern.test(sourceText)) return "BUSINESS";
  if (publicServicePattern.test(sourceText)) return "PUBLIC_SERVICE";
  if (landmarkPattern.test(sourceText)) return "LANDMARK";
  if (neighborhoodPattern.test(sourceText)) return "NEIGHBORHOOD";
  if (streetPattern.test(sourceText)) return "STREET";

  if (businessPattern.test(categoryText)) return "BUSINESS";
  if (publicServicePattern.test(categoryText)) return "PUBLIC_SERVICE";
  if (landmarkPattern.test(categoryText)) return "LANDMARK";
  if (neighborhoodPattern.test(categoryText)) return "NEIGHBORHOOD";
  if (/^(شارع|طريق|نفق|دوار|تقاطع|جولة|ميدان|street|road|route|highway|intersection|roundabout)(?:\s|$)/i.test(nameText)) return "STREET";
  if (/(حارة|حي\s|منطقة سكنية|قرية|عزلة|محلة|neighborhood|district|suburb|village|locality)/i.test(nameText)) return "NEIGHBORHOOD";
  if (businessPattern.test(nameText) || /(مكتبة|صيدلية|بقالة|مطعم|متجر|محل)/i.test(nameText)) return "BUSINESS";
  if (publicServicePattern.test(nameText)) return "PUBLIC_SERVICE";
  if (landmarkPattern.test(nameText)) return "LANDMARK";
  if (streetPattern.test(nameText)) return "STREET";
  return "OTHER";
}

function jsonResponse(data, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}

function pageParams(url, maxLimit) {
  const limitRaw = Number(url.searchParams.get("limit") || 100);
  const offsetRaw = Number(url.searchParams.get("offset") || 0);
  return {
    limit: Number.isFinite(limitRaw) ? Math.max(1, Math.min(maxLimit, Math.floor(limitRaw))) : 100,
    offset: Number.isFinite(offsetRaw) ? Math.max(0, Math.min(50000, Math.floor(offsetRaw))) : 0
  };
}

function mapPlaceOut(row) {
  let geometry = null;
  let openingHours = {};
  let description = String(row.description || "").trim();
  if (!description || description === "null" || /^[\\[{]/.test(description)) description = null;
  try { openingHours = JSON.parse(row.opening_hours_json || "{}"); } catch (_) { openingHours = {}; }
  if (row.geometry_json) {
    try { geometry = JSON.parse(row.geometry_json); } catch (_) { geometry = null; }
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    category: row.category,
    address: row.address,
    district: row.district,
    neighborhood: row.neighborhood,
    phone: row.phone || null,
    description,
    cover_image_url: row.cover_image_url,
    opening_hours: openingHours,
    rating: row.rating == null ? null : Number(row.rating),
    review_count: Number(row.review_count || 0),
    operational_status: row.operational_status || "UNKNOWN",
    source_name: row.source_name,
    source_category: row.source_category,
    plus_code: row.plus_code,
    osm_source_id: row.osm_source_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    location_precision: row.location_precision,
    geometry_type: row.geometry_type,
    geometry,
    maps_url: row.maps_url || ("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(Number(row.latitude) + "," + Number(row.longitude))),
    is_commercial: Number(row.is_commercial) === 1
  };
}

async function listMapPlaces(url, env, origin) {
  const bounds = parseBbox(url.searchParams.get("bbox"));
  if (!bounds) return jsonResponse({ ok: false, error: "INVALID_BBOX", message: "نطاق الخريطة غير صالح." }, 400, origin);
  const zoom = Math.max(1, Math.min(22, Number(url.searchParams.get("zoom") || 13)));
  const kind = String(url.searchParams.get("kind") || "").toUpperCase();
  const category = normalizeText(url.searchParams.get("category") || "");
  const q = normalizeText(url.searchParams.get("q") || "").slice(0, 80);
  if (kind && !KINDS.has(kind)) return jsonResponse({ ok: false, error: "INVALID_KIND" }, 400, origin);

  const where = [
    "visibility_status='PUBLISHED'",
    "verification_status='VERIFIED_MATCH'",
    "is_public=1",
    "latitude IS NOT NULL",
    "longitude IS NOT NULL",
    "latitude BETWEEN ? AND ?",
    "longitude BETWEEN ? AND ?"
  ];
  const values = [bounds.south, bounds.north, bounds.west, bounds.east];
  if (kind) { where.push("kind=?"); values.push(kind); }
  if (category) { where.push("category_norm=?"); values.push(category); }
  if (q) {
    where.push("(instr(name_norm,?)>0 OR instr(category_norm,?)>0 OR instr(address_norm,?)>0)");
    values.push(q, q, q);
  }
  const whereSql = where.join(" AND ");
  const step = q ? 0 : clusterStep(zoom);

  if (step > 0) {
    const sql = "SELECT ROUND(latitude / ?) AS lat_cell, ROUND(longitude / ?) AS lng_cell, COUNT(*) AS count, AVG(latitude) AS latitude, AVG(longitude) AS longitude " +
      "FROM directory_places WHERE " + whereSql + " GROUP BY lat_cell,lng_cell ORDER BY count DESC LIMIT 1200";
    const result = await env.DB.prepare(sql).bind(step, step, ...values).all();
    const items = (result.results || []).map((row) => ({
      cluster: true,
      id: "cluster-" + row.lat_cell + "-" + row.lng_cell,
      count: Number(row.count),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude)
    }));
    return jsonResponse({ ok: true, api_version: API_VERSION, clustered: true, items, bounds }, 200, origin);
  }

  const page = pageParams(url, 500);
  const sql = "SELECT id,name,kind,category,address,district,neighborhood,phone,description,cover_image_url,opening_hours_json,rating,review_count,operational_status,source_name,source_category,plus_code,osm_source_id,latitude,longitude,location_precision,geometry_type,geometry_json,maps_url,is_commercial " +
    "FROM directory_places WHERE " + whereSql + " ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?";
  const result = await env.DB.prepare(sql).bind(...values, page.limit, page.offset).all();
  const rows = result.results || [];
  return jsonResponse({
    ok: true,
    api_version: API_VERSION,
    clustered: false,
    items: rows.map(mapPlaceOut),
    limit: page.limit,
    offset: page.offset,
    has_more: rows.length === page.limit,
    bounds
  }, 200, origin);
}

async function getMapPlace(id, env, origin) {
  if (!id || id.length > 128) return jsonResponse({ ok: false, error: "INVALID_ID" }, 400, origin);
  const row = await env.DB.prepare(
    "SELECT id,name,kind,category,address,district,neighborhood,phone,description,cover_image_url,opening_hours_json,rating,review_count,operational_status,source_name,source_category,plus_code,osm_source_id,latitude,longitude,location_precision,geometry_type,geometry_json,maps_url,is_commercial " +
    "FROM directory_places WHERE id=? AND visibility_status='PUBLISHED' AND verification_status='VERIFIED_MATCH' AND is_public=1"
  ).bind(id).first();
  return row ? jsonResponse({ ok: true, item: mapPlaceOut(row) }, 200, origin) : jsonResponse({ ok: false, error: "NOT_FOUND" }, 404, origin);
}

async function listCatalogProducts(url, env, origin) {
  const q = normalizeText(url.searchParams.get("q") || "").slice(0, 80);
  const category = normalizeText(url.searchParams.get("category") || "");
  const page = pageParams(url, 100);
  const where = ["quality_status='PUBLISHED'"];
  const values = [];
  if (q) {
    where.push("(instr(lower(name_ar),?)>0 OR instr(lower(brand_ar),?)>0 OR instr(lower(category_ar),?)>0)");
    values.push(q, q, q);
  }
  if (category) { where.push("lower(category_ar)=?"); values.push(category); }
  values.push(page.limit, page.offset);
  const sql = "SELECT barcode,name_ar,brand_ar,category_ar,description_ar,image_key,image_status,translation_status,availability_status,country_relevance " +
    "FROM catalog_products WHERE " + where.join(" AND ") + " ORDER BY name_ar COLLATE NOCASE LIMIT ? OFFSET ?";
  const result = await env.DB.prepare(sql).bind(...values).all();
  return jsonResponse({
    ok: true,
    api_version: API_VERSION,
    items: (result.results || []).map((row) => ({
      barcode: row.barcode,
      name: row.name_ar,
      brand: row.brand_ar,
      category: row.category_ar,
      description: row.description_ar,
      image_url: row.image_status === "READY" && row.image_key ? ("/api/v1/media/products/" + encodeURIComponent(row.image_key) + ".webp") : "",
      image_status: row.image_status,
      translation_status: row.translation_status,
      availability_status: row.availability_status,
      country_relevance: row.country_relevance,
      availability_label_ar: "مرجع عالمي؛ لا يثبت التوفر في اليمن أو لدى المتجر",
      catalog_only: true,
      merchant_confirmed: false
    })),
    limit: page.limit,
    offset: page.offset
  }, 200, origin);
}

async function storeCatalogSuggestions(storeId, env, origin) {
  if (!storeId || storeId.length > 128) return jsonResponse({ ok: false, error: "INVALID_STORE_ID" }, 400, origin);
  const store = await env.DB.prepare("SELECT id,name,category,neighborhood FROM stores WHERE id=? AND status='APPROVED'").bind(storeId).first();
  if (!store) return jsonResponse({ ok: false, error: "NOT_FOUND" }, 404, origin);
  const result = await env.DB.prepare(
    "SELECT c.barcode,c.name_ar,c.brand_ar,c.category_ar,c.description_ar,c.image_key,c.image_status,c.availability_status,c.translation_status,c.country_relevance,s.match_score,s.match_reason,s.status " +
    "FROM store_catalog_suggestions s JOIN catalog_products c ON c.barcode=s.barcode " +
    "WHERE s.store_id=? AND s.status IN ('SUGGESTED','MERCHANT_CONFIRMED') AND c.quality_status='PUBLISHED' " +
    "ORDER BY CASE WHEN s.status='MERCHANT_CONFIRMED' THEN 0 ELSE 1 END,s.match_score DESC LIMIT 60"
  ).bind(storeId).all();
  return jsonResponse({
    ok: true,
    store: { id: store.id, name: store.name, category: store.category, neighborhood: store.neighborhood },
    items: (result.results || []).map((row) => ({
      barcode: row.barcode,
      name: row.name_ar,
      brand: row.brand_ar,
      category: row.category_ar,
      description: row.description_ar,
      image_url: row.image_status === "READY" && row.image_key ? ("/api/v1/media/products/" + encodeURIComponent(row.image_key) + ".webp") : "",
      match_score: Number(row.match_score),
      match_reason: row.match_reason,
      availability_status: row.availability_status,
      country_relevance: row.country_relevance,
      translation_status: row.translation_status,
      availability_label_ar: "مرجع عالمي؛ ليس مخزونًا مؤكدًا",
      merchant_confirmed: row.status === "MERCHANT_CONFIRMED",
      catalog_only: true
    }))
  }, 200, origin);
}


async function directoryCatalogSuggestions(placeId, env, origin) {
  if (!placeId || placeId.length > 128) return jsonResponse({ ok: false, error: "INVALID_PLACE_ID" }, 400, origin);
  const place = await env.DB.prepare(
    "SELECT id,name,kind,category,address,neighborhood FROM directory_places WHERE id=? AND kind='BUSINESS' AND visibility_status='PUBLISHED' AND verification_status='VERIFIED_MATCH' AND is_public=1"
  ).bind(placeId).first();
  if (!place) return jsonResponse({ ok: false, error: "NOT_FOUND" }, 404, origin);
  const result = await env.DB.prepare(
    "SELECT p.barcode,p.name_ar,p.brand_ar,p.category_ar,p.description_ar,p.image_key,p.image_status,p.availability_status,p.translation_status,p.country_relevance,s.match_score,s.match_reason,s.status " +
    "FROM directory_catalog_suggestions s JOIN catalog_products p ON p.barcode=s.barcode " +
    "WHERE s.directory_place_id=? AND s.status IN ('SUGGESTED','MERCHANT_CONFIRMED') AND p.quality_status='PUBLISHED' " +
    "ORDER BY CASE WHEN s.status='MERCHANT_CONFIRMED' THEN 0 ELSE 1 END,s.match_score DESC LIMIT 40"
  ).bind(placeId).all();
  return jsonResponse({
    ok: true,
    place: { id: place.id, name: place.name, kind: place.kind, category: place.category, address: place.address, neighborhood: place.neighborhood },
    items: (result.results || []).map((row) => ({
      barcode: row.barcode,
      name: row.name_ar,
      brand: row.brand_ar,
      category: row.category_ar,
      description: row.description_ar,
      image_url: row.image_status === "READY" && row.image_key ? ("/api/v1/media/products/" + encodeURIComponent(row.image_key) + ".webp") : "",
      match_score: Number(row.match_score),
      match_reason: row.match_reason,
      merchant_confirmed: row.status === "MERCHANT_CONFIRMED",
      availability_status: row.availability_status,
      country_relevance: row.country_relevance,
      translation_status: row.translation_status,
      availability_label_ar: "مرجع عالمي؛ لا يثبت التوفر لدى هذه المنشأة",
      catalog_only: true
    }))
  }, 200, origin);
}

async function getProductImage(barcode, env) {
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(barcode)) return new Response("INVALID_IMAGE_KEY", { status: 400 });
  if (!env.PRODUCTS) return new Response("PRODUCT_IMAGE_STORAGE_NOT_CONFIGURED", { status: 503 });
  const object = await env.PRODUCTS.get("products/" + barcode + ".webp");
  if (!object) return new Response("NOT_FOUND", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") || "image/webp");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}


function authorizedImport(req, env) {
  const expected = String(env.IMPORT_API_KEY || env.ADMIN_API_KEY || "");
  const supplied = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && constantTimeEqual(expected, supplied));
}

async function readImportItems(req, maxItems) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > 1200000) return { error: "PAYLOAD_TOO_LARGE", status: 413 };
  let raw = "";
  try { raw = await req.text(); } catch (_) { return { error: "INVALID_BODY", status: 400 }; }
  if (raw.length > 1200000) return { error: "PAYLOAD_TOO_LARGE", status: 413 };
  let body;
  try { body = JSON.parse(raw); } catch (_) { return { error: "INVALID_JSON", status: 400 }; }
  if (!body || !Array.isArray(body.items)) return { error: "ITEMS_ARRAY_REQUIRED", status: 400 };
  if (body.items.length > maxItems) return { error: "BATCH_LIMIT_EXCEEDED", status: 413, max_items: maxItems };
  return { items: body.items };
}

function textValue(value, max = 4000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const GOOGLE_MAPS_ARCHIVE_SOURCE = "GOOGLE_MAPS_ARCHIVE_WORKBOOK";
const GOOGLE_MAPS_ARCHIVE_FILE = "verified_ibb_registry.xlsx";
const GOOGLE_MAPS_ARCHIVE_ROWS = 7015;

export function classifyGoogleMapsArchiveConflicts(rows, existingRows) {
  const byId = new Map();
  const bySourceRow = new Map();
  for (const existing of existingRows || []) {
    byId.set(existing.id, existing);
    bySourceRow.set(existing.source_file + "\u0000" + existing.source_record_id, existing);
  }

  const seenIds = new Set();
  const seenPlaceIds = new Set();
  const seenSourceRows = new Set();
  const newRows = [];
  const conflicts = [];
  let skippedExisting = 0;
  let skippedChangedSourceHash = 0;

  for (const row of rows) {
    const sourceKey = row.source_file + "\u0000" + row.source_record_id;
    if (seenIds.has(row.id) || seenPlaceIds.has(row.place_id) || seenSourceRows.has(sourceKey)) {
      conflicts.push({ id: row.id, source_record_id: row.source_record_id, reason: "DUPLICATE_WITHIN_REQUEST" });
      continue;
    }
    seenIds.add(row.id);
    seenPlaceIds.add(row.place_id);
    seenSourceRows.add(sourceKey);

    const idMatch = byId.get(row.id);
    const sourceMatch = bySourceRow.get(sourceKey);
    if (idMatch && sourceMatch) {
      if (idMatch.id !== sourceMatch.id || idMatch.place_id !== row.place_id || sourceMatch.place_id !== row.place_id) {
        conflicts.push({ id: row.id, source_record_id: row.source_record_id, reason: "EXISTING_ID_AND_SOURCE_ROW_DISAGREE" });
        continue;
      }
      skippedExisting += 1;
      if (String(idMatch.source_hash || "") !== String(row.source_hash || "")) skippedChangedSourceHash += 1;
      continue;
    }
    if (idMatch) {
      conflicts.push({ id: row.id, source_record_id: row.source_record_id, reason: "PLACE_ID_ALREADY_LINKED_TO_DIFFERENT_SOURCE_ROW" });
      continue;
    }
    if (sourceMatch) {
      conflicts.push({ id: row.id, source_record_id: row.source_record_id, reason: "SOURCE_ROW_ALREADY_LINKED_TO_DIFFERENT_PLACE" });
      continue;
    }
    newRows.push(row);
  }

  return conflicts.length
    ? { ok: false, conflicts: conflicts.slice(0, 10) }
    : { ok: true, newRows, skippedExisting, skippedChangedSourceHash };
}

export async function validateGoogleMapsArchiveCandidate(x) {
  const fail = (reason) => ({ ok: false, reason });
  if (!x || typeof x !== "object" || Array.isArray(x)) return fail("RECORD_MUST_BE_OBJECT");
  const record = /^unique-sheet-row-(\d+)$/.exec(String(x.source_record_id || ""));
  const sequence = record ? Number(record[1]) : 0;
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > GOOGLE_MAPS_ARCHIVE_ROWS) return fail("INVALID_SOURCE_ROW");
  if (!/^gmaps-[a-f0-9]{24}$/.test(String(x.id || ""))) return fail("INVALID_ARCHIVE_ID");
  if (!/^ChI[A-Za-z0-9_-]{10,}$/.test(String(x.place_id || ""))) return fail("INVALID_PLACE_ID");
  if (!/^[a-f0-9]{64}$/.test(String(x.source_hash || ""))) return fail("INVALID_SOURCE_HASH");
  if (x.source_file !== GOOGLE_MAPS_ARCHIVE_FILE || !String(x.name || "").trim()) return fail("SOURCE_FILE_NOT_ALLOWLISTED");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(x.place_id)));
  const digestHex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (x.id !== "gmaps-" + digestHex.slice(0, 24)) return fail("ARCHIVE_ID_PLACE_ID_MISMATCH");
  if (x.source_name !== GOOGLE_MAPS_ARCHIVE_SOURCE ||
      x.source_status !== "ARCHIVE_EXTRACTED_NOT_INDEPENDENTLY_REVIEWED") return fail("SOURCE_NOT_ALLOWLISTED");
  if (x.identity_status !== "UNVERIFIED" ||
      x.verification_status !== "UNVERIFIED" ||
      x.visibility_status !== "NEEDS_REVIEW" ||
      !(x.is_public === 0 || x.is_public === false) ||
      !(x.is_commercial === 1 || x.is_commercial === true)) return fail("UNSAFE_REVIEW_STATE");
  if (x.kind !== "BUSINESS" || x.operational_status !== "UNKNOWN" || x.geometry_type !== "POINT") return fail("INVALID_ARCHIVE_KIND_OR_STATUS");

  const lat = numericValue(x.latitude), lon = numericValue(x.longitude);
  if (x.location_status === "MISSING") {
    if (x.location_precision !== "MISSING" || lat !== null || lon !== null) return fail("MISSING_LOCATION_MUST_HAVE_NULL_COORDINATES");
  } else if (x.location_status === "APPROXIMATE") {
    if (x.location_precision !== "APPROXIMATE" || lat === null || lon === null ||
        lat < 13.7 || lat > 14.3 || lon < 43.7 || lon > 44.5) return fail("APPROXIMATE_LOCATION_OUT_OF_BOUNDS");
  } else {
    return fail("INVALID_LOCATION_STATUS");
  }
  return { ok: true, sequence };
}

async function importRows(req, env, origin, type) {
  if (!authorizedImport(req, env)) return jsonResponse({ ok: false, error: "UNAUTHORIZED" }, 401, origin);
  const maxItems = (type === "directory" || type === "directory_archive" || type === "products") ? 250 : 500;
  const parsed = await readImportItems(req, maxItems);
  if (parsed.error) return jsonResponse({ ok: false, error: parsed.error, max_items: parsed.max_items }, parsed.status, origin);
  const now = new Date().toISOString();
  let columns, rows, table, conflictKey, updateFields;
  if (type === "directory" || type === "directory_archive") {
    table = "directory_places";
    columns = ["id","source_file","source_record_id","name","name_norm","kind","category","category_norm","source_category","address","address_norm","district","neighborhood","phone","email","website_url","description","cover_image_url","opening_hours_json","rating","review_count","operational_status","latitude","longitude","geometry_type","geometry_json","location_precision","identity_status","location_status","verification_status","visibility_status","is_commercial","is_public","place_id","plus_code","osm_source_id","maps_url","source_name","source_status","source_url","source_hash","created_at","updated_at"];
    const allowedKinds = new Set(["BUSINESS","LANDMARK","STREET","NEIGHBORHOOD","PUBLIC_SERVICE","OTHER"]);
    const allowedVisibility = new Set(["PUBLISHED","NEEDS_REVIEW","HIDDEN"]);
    const allowedVerification = new Set(["VERIFIED_MATCH","PARTIAL_MATCH","UNVERIFIED","REJECTED"]);
    const allowedPrecision = new Set(["EXACT","APPROXIMATE","MISSING"]);
    const allowedOperational = new Set(["OPEN","CLOSED","TEMPORARILY_CLOSED","UNKNOWN"]);
    rows = [];
    for (const x of parsed.items) {
      const lat = numericValue(x.latitude), lon = numericValue(x.longitude);
      const kind = textValue(x.kind, 32), visibility = textValue(x.visibility_status, 32), verification = textValue(x.verification_status, 32);
      if (!textValue(x.id,128) || !textValue(x.name,300) || !allowedKinds.has(kind) || !allowedVisibility.has(visibility) || !allowedVerification.has(verification)) {
        return jsonResponse({ ok:false,error:"INVALID_DIRECTORY_RECORD",record_id:textValue(x.id,128) },400,origin);
      }
      if (visibility === "PUBLISHED" && (verification !== "VERIFIED_MATCH" || lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180)) {
        return jsonResponse({ ok:false,error:"PUBLISHED_PLACE_REQUIRES_VERIFIED_COORDINATES",record_id:textValue(x.id,128) },400,origin);
      }
      if (type === "directory_archive") {
        const archiveCheck = await validateGoogleMapsArchiveCandidate(x);
        if (!archiveCheck.ok) return jsonResponse({ok:false,error:"UNSAFE_GOOGLE_MAPS_ARCHIVE_RECORD",reason:archiveCheck.reason,record_id:textValue(x.id,128)},400,origin);
      }
      const precision = textValue(x.location_precision,24);
      const operational = textValue(x.operational_status,32);
      if (!allowedPrecision.has(precision) || !allowedOperational.has(operational)) return jsonResponse({ok:false,error:"INVALID_PLACE_STATUS",record_id:textValue(x.id,128)},400,origin);
      rows.push({
        ...x, id:textValue(x.id,128), source_file:textValue(x.source_file,200), source_record_id:textValue(x.source_record_id,200),
        name:textValue(x.name,300), name_norm:textValue(x.name_norm,400), kind, category:textValue(x.category,160),
        category_norm:textValue(x.category_norm,200), source_category:textValue(x.source_category,200),
        address:textValue(x.address,1000), address_norm:textValue(x.address_norm,1200), district:textValue(x.district,200),
        neighborhood:textValue(x.neighborhood,200), phone:textValue(x.phone,100), email:textValue(x.email,200),
        website_url:textValue(x.website_url,1000), description:textValue(x.description,1200), cover_image_url:textValue(x.cover_image_url,2000),
        opening_hours_json:textValue(x.opening_hours_json || "{}",4000), rating:numericValue(x.rating), review_count:Math.max(0,Math.floor(numericValue(x.review_count)||0)),
        operational_status:operational, latitude:lat, longitude:lon, geometry_type:textValue(x.geometry_type || "POINT",24),
        geometry_json:textValue(x.geometry_json,20000), location_precision:precision,
        identity_status:textValue(x.identity_status,32), location_status:textValue(x.location_status,32), verification_status:verification,
        visibility_status:visibility, is_commercial:x.is_commercial ? 1 : 0, is_public:x.is_public ? 1 : 0,
        place_id:textValue(x.place_id,256), plus_code:textValue(x.plus_code,100), osm_source_id:textValue(x.osm_source_id,200),
        maps_url:textValue(x.maps_url,2000), source_name:textValue(x.source_name,100), source_status:textValue(x.source_status,200),
        source_url:textValue(x.source_url,2000), source_hash:textValue(x.source_hash,128), created_at:textValue(x.created_at,64)||now, updated_at:textValue(x.updated_at,64)||now
      });
    }
    conflictKey = "id";
  } else if (type === "products") {
    table = "catalog_products";
    columns = ["barcode","name_source","name_ar","brand_source","brand_ar","category_source","category_ar","description_ar","image_key","image_source_url","image_drive_file_id","image_status","quality_status","translation_status","availability_status","country_relevance","countries_source","source_name","source_url","country_code","created_at","updated_at"];
    rows = [];
    for (const x of parsed.items) {
      const barcode = textValue(x.barcode,32);
      const imageStatus = textValue(x.image_status,24), quality = textValue(x.quality_status,24);
      const translation = textValue(x.translation_status,32), availability = textValue(x.availability_status,32), relevance = textValue(x.country_relevance,32);
      if (!/^\d{8,14}$/.test(barcode) || !textValue(x.name_ar,300) || !["MISSING","PENDING","READY","FAILED"].includes(imageStatus) ||
          !["CANDIDATE","PUBLISHED","REJECTED"].includes(quality) || !["SOURCE_ARABIC","MODEL_TRANSLATED","REVIEWED","NEEDS_TRANSLATION"].includes(translation) ||
          !["REFERENCE_ONLY","LOCAL_VERIFIED","MERCHANT_CONFIRMED"].includes(availability) || !["YEMEN","ARABIC_REGION","UNKNOWN","FOREIGN"].includes(relevance)) {
        return jsonResponse({ok:false,error:"INVALID_CATALOG_PRODUCT",barcode},400,origin);
      }
      if (availability !== "REFERENCE_ONLY") return jsonResponse({ok:false,error:"CATALOG_IMPORT_MUST_BE_REFERENCE_ONLY",barcode},400,origin);
      rows.push({
        ...x, barcode, name_source:textValue(x.name_source,500), name_ar:textValue(x.name_ar,300),
        brand_source:textValue(x.brand_source,300), brand_ar:textValue(x.brand_ar,300),
        category_source:textValue(x.category_source,500), category_ar:textValue(x.category_ar,200),
        description_ar:textValue(x.description_ar,1000), image_key:textValue(x.image_key,64),
        image_source_url:textValue(x.image_source_url,2000), image_drive_file_id:textValue(x.image_drive_file_id,256),
        image_status:imageStatus, quality_status:quality, translation_status:translation,
        availability_status:availability, country_relevance:relevance, countries_source:textValue(x.countries_source,500),
        source_name:textValue(x.source_name,100), source_url:textValue(x.source_url,2000),
        country_code:textValue(x.country_code,12), created_at:textValue(x.created_at,64)||now, updated_at:textValue(x.updated_at,64)||now
      });
    }
    conflictKey = "barcode";
  } else {
    table = "directory_catalog_suggestions";
    columns = ["id","directory_place_id","barcode","match_score","match_reason","status","created_at","reviewed_at"];
    rows = [];
    for (const x of parsed.items) {
      const score = numericValue(x.match_score), status = textValue(x.status,32);
      if (!textValue(x.id,128) || !textValue(x.directory_place_id,128) || !/^\d{8,14}$/.test(textValue(x.barcode,32)) ||
          score === null || score < 0 || score > 1 || !["SUGGESTED","MERCHANT_CONFIRMED","REJECTED"].includes(status)) {
        return jsonResponse({ok:false,error:"INVALID_DIRECTORY_CATALOG_SUGGESTION",suggestion_id:textValue(x.id,128)},400,origin);
      }
      rows.push({id:textValue(x.id,128),directory_place_id:textValue(x.directory_place_id,128),barcode:textValue(x.barcode,32),match_score:score,match_reason:textValue(x.match_reason,1000),status,created_at:textValue(x.created_at,64)||now,reviewed_at:x.reviewed_at?textValue(x.reviewed_at,64):null});
    }
    conflictKey = "id";
  }
  if (!rows.length) return jsonResponse({ok:true,imported:0,table},200,origin);
  const archiveInsertOnly = type === "directory_archive";
  let rowsToInsert = rows;
  let archivePlan = null;
  if (archiveInsertOnly) {
    try {
      const idPlaceholders = rows.map(() => "?").join(",");
      const sourcePlaceholders = rows.map(() => "?").join(",");
      const existingResult = await env.DB.prepare(
        "SELECT id,source_file,source_record_id,place_id,source_hash FROM directory_places " +
        "WHERE id IN (" + idPlaceholders + ") OR (source_file=? AND source_record_id IN (" + sourcePlaceholders + "))"
      ).bind(...rows.map((row) => row.id), GOOGLE_MAPS_ARCHIVE_FILE, ...rows.map((row) => row.source_record_id)).all();
      archivePlan = classifyGoogleMapsArchiveConflicts(rows, existingResult.results || []);
      if (!archivePlan.ok) return jsonResponse({
        ok:false,error:"ARCHIVE_SOURCE_CONFLICT",conflicts:archivePlan.conflicts,
        message:"Existing directory rows do not match the incoming Place ID and source-row identity. No rows in this batch were written."
      },409,origin);
      rowsToInsert = archivePlan.newRows;
      if (!rowsToInsert.length) return jsonResponse({
        ok:true,table,attempted:rows.length,imported:0,skipped:rows.length,
        skipped_existing:archivePlan.skippedExisting,
        skipped_changed_source_hash:archivePlan.skippedChangedSourceHash,
        conflict_policy:"INSERT_ONLY"
      },200,origin);
    } catch (error) {
      return jsonResponse({ok:false,error:"ARCHIVE_PREFLIGHT_FAILED",detail:textValue(error && error.message,300)},500,origin);
    }
  }
  const updates = columns.filter((x) => x !== conflictKey && x !== "created_at").map((x) => x+"=excluded."+x).join(",");
  const sql = archiveInsertOnly
    ? "INSERT INTO "+table+" ("+columns.join(",")+") VALUES ("+columns.map(()=>"?").join(",")+") ON CONFLICT DO NOTHING"
    : "INSERT INTO "+table+" ("+columns.join(",")+") VALUES ("+columns.map(()=>"?").join(",")+") ON CONFLICT("+conflictKey+") DO UPDATE SET "+updates;
  try {
    const statements = rowsToInsert.map((row) => env.DB.prepare(sql).bind(...columns.map((key) => row[key] === undefined ? null : row[key])));
    const results = await env.DB.batch(statements);
    if (archiveInsertOnly) {
      const inserted = (results || []).reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0);
      const skipped = archivePlan.skippedExisting + (rowsToInsert.length - inserted);
      return jsonResponse({
        ok:true,table,attempted:rows.length,imported:inserted,skipped,
        skipped_existing:archivePlan.skippedExisting,
        skipped_changed_source_hash:archivePlan.skippedChangedSourceHash,
        skipped_write_race:rowsToInsert.length-inserted,
        conflict_policy:"INSERT_ONLY",
        first_id:rows[0][conflictKey],last_id:rows[rows.length-1][conflictKey]
      },200,origin);
    }
    return jsonResponse({ok:true,table,imported:rows.length,first_id:rows[0][conflictKey],last_id:rows[rows.length-1][conflictKey]},200,origin);
  } catch (error) {
    return jsonResponse({ok:false,error:"DB_IMPORT_FAILED",detail:textValue(error && error.message,500),table},500,origin);
  }
}

async function importStats(env, origin) {
  try {
    const queries = [
      ["directory_places","SELECT COUNT(*) AS total FROM directory_places"],
      ["published_places","SELECT COUNT(*) AS total FROM directory_places WHERE visibility_status='PUBLISHED' AND verification_status='VERIFIED_MATCH' AND is_public=1"],
      ["catalog_products","SELECT COUNT(*) AS total FROM catalog_products"],
      ["published_products","SELECT COUNT(*) AS total FROM catalog_products WHERE quality_status='PUBLISHED'"],
      ["products_with_images","SELECT COUNT(*) AS total FROM catalog_products WHERE image_status='READY'"],
      ["directory_suggestions","SELECT COUNT(*) AS total FROM directory_catalog_suggestions"]
    ];
    const results = await Promise.all(queries.map(async ([key,sql]) => {
      const row = await env.DB.prepare(sql).first();
      return [key,Number(row && row.total || 0)];
    }));
    return jsonResponse({ok:true,stats:Object.fromEntries(results)},200,origin);
  } catch (error) {
    return jsonResponse({ok:false,error:"DB_STATS_FAILED",detail:textValue(error && error.message,300)},500,origin);
  }
}

export async function handleDirectoryCatalog(req, env, url, origin) {
  if (req.method === "GET" && url.pathname === "/api/v1/admin/catalog/stats") {
    if (!authorizedImport(req, env)) return jsonResponse({ok:false,error:"UNAUTHORIZED"},401,origin);
    return importStats(env, origin);
  }
  if (req.method === "POST" && url.pathname === "/api/v1/admin/directory/import") return importRows(req, env, origin, "directory");
  if (req.method === "POST" && url.pathname === "/api/v1/admin/directory/archive-import") return importRows(req, env, origin, "directory_archive");
  if (req.method === "POST" && url.pathname === "/api/v1/admin/catalog/import") return importRows(req, env, origin, "products");
  if (req.method === "POST" && url.pathname === "/api/v1/admin/directory-catalog-suggestions/import") return importRows(req, env, origin, "suggestions");
  if (req.method === "GET" && url.pathname === "/api/v1/map/places") return listMapPlaces(url, env, origin);
  let match = url.pathname.match(/^\/api\/v1\/map\/places\/([^/]+)$/);
  if (req.method === "GET" && match) return getMapPlace(decodeURIComponent(match[1]), env, origin);
  if (req.method === "GET" && url.pathname === "/api/v1/catalog/products") return listCatalogProducts(url, env, origin);
  match = url.pathname.match(/^\/api\/v1\/stores\/([^/]+)\/catalog-suggestions$/);
  if (req.method === "GET" && match) return storeCatalogSuggestions(decodeURIComponent(match[1]), env, origin);
  match = url.pathname.match(/^\/api\/v1\/map\/places\/([^/]+)\/catalog-suggestions$/);
  if (req.method === "GET" && match) return directoryCatalogSuggestions(decodeURIComponent(match[1]), env, origin);
  match = url.pathname.match(/^\/api\/v1\/media\/products\/([A-Za-z0-9_-]{3,64})\.webp$/);
  if (req.method === "GET" && match) return getProductImage(match[1], env);
  if (req.method === "GET" && url.pathname === "/api/v1/payments/readiness") {
    return jsonResponse({ ok: true, api_version: API_VERSION, payment: paymentReadiness(env) }, 200, origin);
  }
  return null;
}

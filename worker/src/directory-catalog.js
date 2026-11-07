import { paymentReadiness } from "./payments/adapter.js";

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
  if (east - west > 1.2 || north - south > 1.2) return null;
  return { west, south, east, north };
}

export function clusterStep(zoom) {
  if (zoom <= 10) return 0.04;
  if (zoom <= 12) return 0.015;
  if (zoom <= 14) return 0.005;
  return 0;
}

export function classifyEntityKind(name, category) {
  const text = normalizeText(String(name || "") + " " + String(category || ""));
  if (/(شارع|طريق|جسر|نفق|دوار|تقاطع|جولة|ميدان)/.test(text)) return "STREET";
  if (/(حارة|حي\s|منطقة سكنية|قرية|عزلة|محلة)/.test(text)) return "NEIGHBORHOOD";
  if (/(جامع|مسجد|مقبرة|مزار|متحف|حديقة|منتزه|ساحة عامة|سوق|قلعة|حصن|أثر|مدرسة تاريخية)/.test(text)) return "LANDMARK";
  if (/(مكتبة عامة|مستشفى|مركز صحي|مستوصف|مدرسة|جامعة|كلية|مكتب حكومي|مركز شرطة|مرفق عام)/.test(text)) return "PUBLIC_SERVICE";
  if (/(محل|متجر|مؤسسة|شركة|مطعم|بقالة|صيدلية|مخبز|معرض|ورشة|مركز تجاري|مكتبة|ملابس|جوالات|إلكترونيات)/.test(text)) return "BUSINESS";
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
    phone: row.phone,
    email: row.email,
    website_url: row.website_url,
    description: row.description,
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
  const sql = "SELECT id,name,kind,category,address,district,neighborhood,phone,email,website_url,description,cover_image_url,opening_hours_json,rating,review_count,operational_status,source_name,source_category,plus_code,osm_source_id,latitude,longitude,location_precision,geometry_type,geometry_json,maps_url,is_commercial " +
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
    "SELECT id,name,kind,category,address,district,neighborhood,phone,email,website_url,description,cover_image_url,opening_hours_json,rating,review_count,operational_status,source_name,source_category,plus_code,osm_source_id,latitude,longitude,location_precision,geometry_type,geometry_json,maps_url,is_commercial " +
    "FROM directory_places WHERE id=? AND visibility_status='PUBLISHED' AND verification_status='VERIFIED_MATCH'"
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
    "SELECT id,name,kind,category,address,neighborhood FROM directory_places WHERE id=? AND kind='BUSINESS' AND visibility_status='PUBLISHED' AND verification_status='VERIFIED_MATCH'"
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

export async function handleDirectoryCatalog(req, env, url, origin) {
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

CREATE TABLE IF NOT EXISTS directory_places (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('BUSINESS','LANDMARK','STREET','NEIGHBORHOOD','PUBLIC_SERVICE','OTHER')),
  category TEXT NOT NULL DEFAULT '',
  category_norm TEXT NOT NULL DEFAULT '',
  source_category TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  address_norm TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT NOT NULL DEFAULT '',
  opening_hours_json TEXT NOT NULL DEFAULT '{}',
  rating REAL,
  review_count INTEGER NOT NULL DEFAULT 0 CHECK(review_count >= 0),
  operational_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(operational_status IN ('OPEN','CLOSED','TEMPORARILY_CLOSED','UNKNOWN')),
  latitude REAL,
  longitude REAL,
  geometry_type TEXT NOT NULL DEFAULT 'POINT' CHECK(geometry_type IN ('POINT','LINESTRING','MULTILINESTRING','POLYGON','MULTIPOLYGON')),
  geometry_json TEXT NOT NULL DEFAULT '',
  location_precision TEXT NOT NULL DEFAULT 'MISSING' CHECK(location_precision IN ('EXACT','APPROXIMATE','MISSING')),
  identity_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK(identity_status IN ('VERIFIED_MATCH','PARTIAL_MATCH','UNVERIFIED','REJECTED')),
  location_status TEXT NOT NULL DEFAULT 'MISSING' CHECK(location_status IN ('EXACT','APPROXIMATE','MISSING','REVIEW_REQUIRED')),
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status IN ('VERIFIED_MATCH','PARTIAL_MATCH','UNVERIFIED','REJECTED')),
  visibility_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(visibility_status IN ('PUBLISHED','NEEDS_REVIEW','HIDDEN')),
  is_commercial INTEGER NOT NULL DEFAULT 0 CHECK(is_commercial IN (0,1)),
  is_public INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0,1)),
  place_id TEXT NOT NULL DEFAULT '',
  plus_code TEXT NOT NULL DEFAULT '',
  osm_source_id TEXT NOT NULL DEFAULT '',
  maps_url TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  source_status TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_file,source_record_id),
  CHECK((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)),
  CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CHECK(rating IS NULL OR rating BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS idx_directory_places_public_geo ON directory_places(visibility_status,verification_status,latitude,longitude);
CREATE INDEX IF NOT EXISTS idx_directory_places_kind_category ON directory_places(kind,category_norm,visibility_status);
CREATE INDEX IF NOT EXISTS idx_directory_places_name ON directory_places(name_norm);
CREATE INDEX IF NOT EXISTS idx_directory_places_place_id ON directory_places(place_id);

CREATE TABLE IF NOT EXISTS catalog_products (
  barcode TEXT PRIMARY KEY,
  name_source TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  brand_source TEXT NOT NULL DEFAULT '',
  brand_ar TEXT NOT NULL DEFAULT '',
  category_source TEXT NOT NULL DEFAULT '',
  category_ar TEXT NOT NULL DEFAULT '',
  description_ar TEXT NOT NULL DEFAULT '',
  image_key TEXT NOT NULL DEFAULT '',
  image_source_url TEXT NOT NULL DEFAULT '',
  image_drive_file_id TEXT NOT NULL DEFAULT '',
  image_status TEXT NOT NULL DEFAULT 'MISSING' CHECK(image_status IN ('MISSING','PENDING','READY','FAILED')),
  quality_status TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK(quality_status IN ('CANDIDATE','PUBLISHED','REJECTED')),
  translation_status TEXT NOT NULL DEFAULT 'NEEDS_TRANSLATION' CHECK(translation_status IN ('SOURCE_ARABIC','MODEL_TRANSLATED','REVIEWED','NEEDS_TRANSLATION')),
  availability_status TEXT NOT NULL DEFAULT 'REFERENCE_ONLY' CHECK(availability_status IN ('REFERENCE_ONLY','LOCAL_VERIFIED','MERCHANT_CONFIRMED')),
  country_relevance TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(country_relevance IN ('YEMEN','ARABIC_REGION','UNKNOWN','FOREIGN')),
  countries_source TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT 'Open Food Facts',
  source_url TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_products_published_category ON catalog_products(quality_status,category_ar,name_ar);
CREATE INDEX IF NOT EXISTS idx_catalog_products_brand ON catalog_products(brand_ar);
CREATE INDEX IF NOT EXISTS idx_catalog_products_availability ON catalog_products(availability_status,quality_status);

CREATE TABLE IF NOT EXISTS store_catalog_suggestions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL REFERENCES catalog_products(barcode) ON DELETE CASCADE,
  match_score REAL NOT NULL CHECK(match_score BETWEEN 0 AND 1),
  match_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'SUGGESTED' CHECK(status IN ('SUGGESTED','MERCHANT_CONFIRMED','REJECTED')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(store_id,barcode)
);
CREATE INDEX IF NOT EXISTS idx_store_catalog_suggestions_store ON store_catalog_suggestions(store_id,status,match_score DESC);

CREATE TABLE IF NOT EXISTS directory_catalog_suggestions (
  id TEXT PRIMARY KEY,
  directory_place_id TEXT NOT NULL REFERENCES directory_places(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL REFERENCES catalog_products(barcode) ON DELETE CASCADE,
  match_score REAL NOT NULL CHECK(match_score BETWEEN 0 AND 1),
  match_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'SUGGESTED' CHECK(status IN ('SUGGESTED','MERCHANT_CONFIRMED','REJECTED')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(directory_place_id,barcode)
);
CREATE INDEX IF NOT EXISTS idx_directory_catalog_suggestions_place ON directory_catalog_suggestions(directory_place_id,status,match_score DESC);

CREATE TABLE IF NOT EXISTS payment_provider_configs (
  provider_code TEXT PRIMARY KEY,
  display_name_ar TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK(environment IN ('sandbox','production')),
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  order_ref TEXT NOT NULL,
  provider_code TEXT NOT NULL,
  provider_reference TEXT NOT NULL DEFAULT '',
  amount_yer INTEGER NOT NULL CHECK(amount_yer > 0),
  currency TEXT NOT NULL DEFAULT 'YER' CHECK(currency='YER'),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK(status IN ('CREATED','PENDING','SUCCEEDED','FAILED','CANCELLED','REFUNDED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_order ON payment_intents(order_ref,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL REFERENCES payment_intents(id),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  signature_valid INTEGER NOT NULL CHECK(signature_valid IN (0,1)),
  received_at TEXT NOT NULL,
  UNIQUE(provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_events_intent ON payment_events(payment_intent_id,received_at DESC);

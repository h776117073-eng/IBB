CREATE TABLE IF NOT EXISTS stores (
id TEXT PRIMARY KEY,name TEXT NOT NULL,name_norm TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',category_norm TEXT NOT NULL DEFAULT '',
description TEXT NOT NULL DEFAULT '',neighborhood TEXT NOT NULL DEFAULT '',neighborhood_norm TEXT NOT NULL DEFAULT '',
latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
status TEXT NOT NULL DEFAULT 'APPROVED' CHECK(status IN ('APPROVED','SUSPENDED')),owner_verified INTEGER NOT NULL DEFAULT 0 CHECK(owner_verified IN (0,1)),
source_submission_id TEXT UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_name_neighborhood ON stores(name_norm,neighborhood_norm);
CREATE INDEX IF NOT EXISTS idx_stores_status_updated ON stores(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS products (
id TEXT PRIMARY KEY,store_id TEXT NOT NULL REFERENCES stores(id),name TEXT NOT NULL,name_norm TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',
category_norm TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',price REAL,currency TEXT NOT NULL DEFAULT 'YER' CHECK(currency='YER'),
image_url TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
source_submission_id TEXT UNIQUE,created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_store_name ON products(store_id,name_norm);
CREATE INDEX IF NOT EXISTS idx_products_status_created ON products(status,created_at DESC);
CREATE TABLE IF NOT EXISTS submissions (
id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('STORE','PRODUCT')),idempotency_key TEXT NOT NULL,payload_json TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),submitter_hash TEXT NOT NULL,
created_at TEXT NOT NULL,reviewed_at TEXT,review_reason TEXT NOT NULL DEFAULT '',UNIQUE(kind,idempotency_key));
CREATE INDEX IF NOT EXISTS idx_submissions_status_created ON submissions(status,created_at DESC);
CREATE TABLE IF NOT EXISTS moderation_audit (
id TEXT PRIMARY KEY,submission_id TEXT NOT NULL REFERENCES submissions(id),decision TEXT NOT NULL CHECK(decision IN ('APPROVE','REJECT')),
reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_moderation_audit_submission ON moderation_audit(submission_id,created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits(bucket_key TEXT PRIMARY KEY,hits INTEGER NOT NULL DEFAULT 0,reset_at INTEGER NOT NULL);

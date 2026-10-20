-- IBB Market shared foundation: secure store claims, moderation, locations and catalogue.
-- Review and deploy only to the intended Supabase project after it is active.
-- Public-client code must never set verification/moderation state or membership roles.

begin;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  name_key text not null check (char_length(btrim(name_key)) between 2 and 180),
  category text not null default '' check (char_length(category) <= 80),
  description text not null default '' check (char_length(description) <= 300),
  public_phone text not null default '' check (char_length(public_phone) <= 40),
  website_url text not null default '' check (char_length(website_url) <= 1000),
  address_text text not null default '' check (char_length(address_text) <= 500),
  latitude double precision,
  longitude double precision,
  location_source text not null default 'unknown'
    check (location_source in ('unknown','device-gps','google-maps-paste','manual-map','imported')),
  location_status text not null default 'pending_review'
    check (location_status in ('missing','pending_review','verified','rejected')),
  web_evidence_status text not null default 'not_checked'
    check (web_evidence_status in ('not_checked','found','not_found','error')),
  web_evidence_url text not null default '' check (char_length(web_evidence_url) <= 1000),
  verification_status text not null default 'needs_verification'
    check (verification_status in ('needs_verification','pending_review','verified','rejected','suspended')),
  moderation_status text not null default 'pending_review'
    check (moderation_status in ('pending_review','approved','rejected','suspended')),
  owner_identity_verified boolean not null default false,
  verified_at timestamptz,
  selling_enabled boolean not null default false,
  logo_public_url text not null default '' check (char_length(logo_public_url) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_lat_lon_pair check (
    (latitude is null and longitude is null) or
    (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  constraint stores_verified_guard check (
    verification_status <> 'verified' or
    (owner_identity_verified = true and verified_at is not null and location_status = 'verified' and moderation_status = 'approved')
  ),
  constraint stores_selling_guard check (
    selling_enabled = false or
    (verification_status = 'verified' and owner_identity_verified = true and moderation_status = 'approved')
  )
);

create index if not exists stores_name_key_idx on public.stores (name_key);
create index if not exists stores_status_idx on public.stores (verification_status, moderation_status);
create index if not exists stores_location_idx on public.stores (latitude, longitude)
  where latitude is not null and longitude is not null;

-- Internal membership table. The client can read its own memberships, but cannot self-assign store roles.
create table if not exists public.store_memberships (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','staff')),
  membership_status text not null default 'active' check (membership_status in ('active','revoked')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

-- Identity evidence and reviewer decisions are private; never expose document content or paths in the public directory.
create table if not exists public.store_claims (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  claimant_id uuid not null references auth.users(id) on delete cascade,
  contact_verified_at timestamptz,
  evidence_storage_path text not null default '',
  claim_note text not null default '' check (char_length(claim_note) <= 2000),
  claim_status text not null default 'pending_review'
    check (claim_status in ('pending_review','approved','rejected','disputed','withdrawn')),
  reviewer_id uuid references auth.users(id),
  decision_reason text not null default '' check (char_length(decision_reason) <= 2000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists store_claims_claimant_idx on public.store_claims (claimant_id, created_at desc);
create index if not exists store_claims_store_idx on public.store_claims (store_id, claim_status);

create table if not exists public.store_verification_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null check (event_type in ('web_check','location_review','identity_review','store_moderation','selling_permission','dispute','suspension')),
  old_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text not null default '' check (char_length(reason) <= 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  name_key text not null check (char_length(btrim(name_key)) between 1 and 180),
  category text not null default '' check (char_length(category) <= 80),
  description text not null default '' check (char_length(description) <= 2000),
  publication_status text not null default 'draft'
    check (publication_status in ('draft','pending_review','approved','rejected','paused','archived')),
  moderation_status text not null default 'pending_review'
    check (moderation_status in ('pending_review','approved','rejected','suspended')),
  currency_code text not null default 'YER' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_store_idx on public.products (store_id, publication_status);
create index if not exists products_name_key_idx on public.products (name_key);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  seller_sku text not null check (char_length(seller_sku) between 1 and 120),
  options jsonb not null default '{}'::jsonb,
  price numeric(14,2) check (price is null or price >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  availability_status text not null default 'unknown'
    check (availability_status in ('unknown','in_stock','out_of_stock','discontinued')),
  stock_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, seller_sku)
);
create index if not exists product_variants_product_idx on public.product_variants (product_id);

-- Image assets stay private until a trusted moderation service approves them.
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 1000),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check (byte_size between 1 and 5242880),
  image_width integer not null check (image_width between 1 and 8192),
  image_height integer not null check (image_height between 1 and 8192),
  content_sha256 text not null default '' check (content_sha256 = '' or content_sha256 ~ '^[a-f0-9]{64}$'),
  moderation_status text not null default 'pending_review'
    check (moderation_status in ('pending_review','approved','rejected','suspended')),
  moderation_provider text not null default '',
  moderation_reason text not null default '' check (char_length(moderation_reason) <= 2000),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint media_asset_owner_scope check (
    (store_id is not null and product_id is null) or
    (store_id is null and product_id is not null)
  )
);
create index if not exists media_assets_review_idx on public.media_assets (moderation_status, created_at);

-- Enforce row-level access on every exposed table.
alter table public.stores enable row level security;
alter table public.store_memberships enable row level security;
alter table public.store_claims enable row level security;
alter table public.store_verification_events enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.media_assets enable row level security;

-- Remove broad inherited client grants before adding least-privilege access.
revoke all on public.stores from anon, authenticated;
revoke all on public.store_memberships from anon, authenticated;
revoke all on public.store_claims from anon, authenticated;
revoke all on public.store_verification_events from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.product_variants from anon, authenticated;
revoke all on public.media_assets from anon, authenticated;

grant select on public.stores to anon, authenticated;
grant insert (name, name_key, category, description, public_phone, website_url, address_text, latitude, longitude, location_source)
  on public.stores to authenticated;
grant update (name, name_key, category, description, public_phone, website_url, address_text, latitude, longitude, location_source)
  on public.stores to authenticated;

grant select on public.store_memberships to authenticated;
grant select, insert on public.store_claims to authenticated;
grant select on public.products to anon, authenticated;
grant insert (store_id, name, name_key, category, description, currency_code) on public.products to authenticated;
grant update (name, name_key, category, description, currency_code) on public.products to authenticated;
grant select on public.product_variants to anon, authenticated;
grant insert (product_id, seller_sku, options, price, quantity, availability_status) on public.product_variants to authenticated;
grant update (seller_sku, options, price, quantity, availability_status) on public.product_variants to authenticated;
grant select, insert on public.media_assets to authenticated;
-- No public/client write grants for verification events or verification state fields.

drop policy if exists stores_public_directory_read on public.stores;
create policy stores_public_directory_read on public.stores
  for select to anon, authenticated using (true);

drop policy if exists stores_authenticated_proposal_insert on public.stores;
create policy stores_authenticated_proposal_insert on public.stores
  for insert to authenticated
  with check (
    verification_status = 'needs_verification'
    and moderation_status = 'pending_review'
    and owner_identity_verified = false
    and selling_enabled = false
    and verified_at is null
  );

drop policy if exists stores_member_profile_update on public.stores;
create policy stores_member_profile_update on public.stores
  for update to authenticated
  using (
    exists (
      select 1 from public.store_memberships m
      where m.store_id = stores.id
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
        and m.role in ('owner','manager')
    )
  )
  with check (
    exists (
      select 1 from public.store_memberships m
      where m.store_id = stores.id
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
        and m.role in ('owner','manager')
    )
  );

drop policy if exists store_memberships_read_own on public.store_memberships;
create policy store_memberships_read_own on public.store_memberships
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists store_claims_read_own on public.store_claims;
create policy store_claims_read_own on public.store_claims
  for select to authenticated using (claimant_id = (select auth.uid()));

drop policy if exists store_claims_insert_own on public.store_claims;
create policy store_claims_insert_own on public.store_claims
  for insert to authenticated
  with check (
    claimant_id = (select auth.uid())
    and claim_status = 'pending_review'
    and reviewer_id is null
    and reviewed_at is null
  );

drop policy if exists products_public_approved_read on public.products;
create policy products_public_approved_read on public.products
  for select to anon, authenticated using (
    publication_status = 'approved'
    and moderation_status = 'approved'
    and exists (
      select 1 from public.stores s
      where s.id = products.store_id
        and s.verification_status = 'verified'
        and s.owner_identity_verified = true
        and s.moderation_status = 'approved'
        and s.selling_enabled = true
    )
  );

drop policy if exists products_member_read on public.products;
create policy products_member_read on public.products
  for select to authenticated using (
    exists (
      select 1 from public.store_memberships m
      where m.store_id = products.store_id
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
    )
  );

drop policy if exists products_member_insert_draft on public.products;
create policy products_member_insert_draft on public.products
  for insert to authenticated
  with check (
    publication_status = 'draft'
    and moderation_status = 'pending_review'
    and exists (
      select 1 from public.store_memberships m
      where m.store_id = products.store_id
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
        and m.role in ('owner','manager','staff')
    )
  );

drop policy if exists products_member_update_draft on public.products;
create policy products_member_update_draft on public.products
  for update to authenticated
  using (
    publication_status in ('draft','rejected','paused')
    and exists (
      select 1 from public.store_memberships m
      where m.store_id = products.store_id
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
        and m.role in ('owner','manager','staff')
    )
  )
  with check (
    publication_status in ('draft','rejected','paused')
    and moderation_status in ('pending_review','rejected')
    and exists (
      select 1 from public.store_memberships m
      where m.store_id = products.store_id
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
        and m.role in ('owner','manager','staff')
    )
  );

drop policy if exists variants_public_approved_read on public.product_variants;
create policy variants_public_approved_read on public.product_variants
  for select to anon, authenticated using (
    exists (
      select 1 from public.products p
      join public.stores s on s.id = p.store_id
      where p.id = product_variants.product_id
        and p.publication_status = 'approved'
        and p.moderation_status = 'approved'
        and s.verification_status = 'verified'
        and s.owner_identity_verified = true
        and s.moderation_status = 'approved'
        and s.selling_enabled = true
    )
  );

drop policy if exists variants_member_read on public.product_variants;
create policy variants_member_read on public.product_variants
  for select to authenticated using (
    exists (
      select 1 from public.products p
      join public.store_memberships m on m.store_id = p.store_id
      where p.id = product_variants.product_id
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
    )
  );

drop policy if exists variants_member_insert on public.product_variants;
create policy variants_member_insert on public.product_variants
  for insert to authenticated with check (
    exists (
      select 1 from public.products p
      join public.store_memberships m on m.store_id = p.store_id
      where p.id = product_variants.product_id
        and p.publication_status in ('draft','rejected','paused')
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
        and m.role in ('owner','manager','staff')
    )
  );

drop policy if exists variants_member_update on public.product_variants;
create policy variants_member_update on public.product_variants
  for update to authenticated
  using (
    exists (
      select 1 from public.products p
      join public.store_memberships m on m.store_id = p.store_id
      where p.id = product_variants.product_id
        and p.publication_status in ('draft','rejected','paused')
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
        and m.role in ('owner','manager','staff')
    )
  )
  with check (
    exists (
      select 1 from public.products p
      join public.store_memberships m on m.store_id = p.store_id
      where p.id = product_variants.product_id
        and p.publication_status in ('draft','rejected','paused')
        and m.user_id = (select auth.uid())
        and m.membership_status = 'active'
        and m.role in ('owner','manager','staff')
    )
  );

drop policy if exists media_assets_owner_read on public.media_assets;
create policy media_assets_owner_read on public.media_assets
  for select to authenticated using (
    uploaded_by = (select auth.uid())
    or exists (
      select 1 from public.store_memberships m
      where m.user_id = (select auth.uid())
        and m.membership_status = 'active'
        and (m.store_id = media_assets.store_id or m.store_id = (select p.store_id from public.products p where p.id = media_assets.product_id))
    )
  );

drop policy if exists media_assets_owner_insert on public.media_assets;
create policy media_assets_owner_insert on public.media_assets
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and moderation_status = 'pending_review'
    and reviewed_by is null
    and reviewed_at is null
    and (
      exists (
        select 1 from public.store_memberships m
        where m.store_id = media_assets.store_id
          and m.user_id = (select auth.uid())
          and m.membership_status = 'active'
      )
      or exists (
        select 1 from public.products p
        join public.store_memberships m on m.store_id = p.store_id
        where p.id = media_assets.product_id
          and m.user_id = (select auth.uid())
          and m.membership_status = 'active'
      )
    )
  );

-- Default privileges for other client roles are deliberately not granted.
commit;

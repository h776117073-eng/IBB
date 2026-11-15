import test from "node:test";import assert from "node:assert/strict";import worker, {norm,storeInput,productInput,safeImage,buildDirectoryCandidateFilter,buildAdminMarketplaceFilter,adminMarketplaceStatusInput} from "../src/index.js";
test("Arabic normalization",()=>assert.equal(norm(" متجر\u00a0 إب "),"متجر إب"));
test("valid location",()=>assert.equal(storeInput({name:"متجر اختبار",latitude:13.966,longitude:44.172}).latitude,13.966));
test("invalid lat/lon/name rejected",()=>{assert.throws(()=>storeInput({name:"متجر",latitude:91,longitude:44}));assert.throws(()=>storeInput({name:" ",latitude:13,longitude:44}));assert.throws(()=>storeInput({name:"متجر",latitude:13,longitude:181}));});
test("YER optional product price",()=>{const x=productInput({name:"منتج",store_name:"متجر",price:""});assert.equal(x.price,null);assert.equal(x.currency,"YER");});
test("negative product price and unsafe image rejected",()=>{assert.throws(()=>productInput({name:"منتج",store_name:"متجر",price:-1}));assert.throws(()=>productInput({name:"منتج",store_name:"متجر",image_url:"javascript:alert(1)"}));});
test("HTTPS image validation",()=>{assert.equal(safeImage("https://images.example/a.webp"),true);assert.equal(safeImage("http://images.example/a.webp"),false);assert.equal(safeImage("https://user:pass@images.example/a"),false);});

test("directory candidate review defaults to the approximate Ibb bounding box",()=>{
  const filter=buildDirectoryCandidateFilter(new URL("https://local.test/api/v1/admin/directory/candidates"));
  assert.equal(filter.area,"ibb");
  assert.match(filter.whereSql,/latitude BETWEEN 13\.82 AND 14\.08/);
  assert.match(filter.whereSql,/longitude BETWEEN 44\.05 AND 44\.32/);
  assert.deepEqual(filter.values,["GOOGLE_MAPS_ARCHIVE_WORKBOOK"]);
});
test("directory candidate review keeps missing and outside coordinates separate",()=>{
  const missing=buildDirectoryCandidateFilter(new URL("https://local.test/?area=missing"));
  const outside=buildDirectoryCandidateFilter(new URL("https://local.test/?area=outside"));
  assert.match(missing.whereSql,/latitude IS NULL OR longitude IS NULL/);
  assert.match(outside.whereSql,/NOT \(latitude BETWEEN 13\.82 AND 14\.08/);
});
test("directory candidate review rejects unsupported area filters",()=>{
  assert.throws(()=>buildDirectoryCandidateFilter(new URL("https://local.test/?area=published")));
});
test("directory candidate review clamps pagination and parameterizes search",()=>{
  const filter=buildDirectoryCandidateFilter(new URL("https://local.test/?area=all&limit=1000&offset=99999&q=%D8%A8%D9%82%D8%A7%D9%84%D8%A9"));
  assert.equal(filter.limit,50);
  assert.equal(filter.offset,5000);
  assert.match(filter.whereSql,/instr\(name_norm,\?\)>0/);
  assert.equal(filter.values.length,7);
});
test("directory candidate review API requires the admin key",async()=>{
  const response=await worker.fetch(new Request("https://worker.test/api/v1/admin/directory/candidates"),{
    DB:{prepare(){throw new Error("database must not be queried without admin auth");}},
    ADMIN_API_KEY:"a".repeat(40)
  });
  assert.equal(response.status,401);
  assert.equal((await response.json()).error,"UNAUTHORIZED");
});
test("directory candidate review API returns an authenticated read-only page",async()=>{
  const row={id:"gmaps-test",name:"متجر اختبار",kind:"BUSINESS",latitude:13.96,longitude:44.18,verification_status:"UNVERIFIED",visibility_status:"NEEDS_REVIEW"};
  const db={prepare(sql){
    return {sql,params:[],bind(...params){this.params=params;return this;},
      first:async()=>sql.includes("SUM(CASE WHEN latitude")?{total:3029,inside_ibb:516,outside_ibb:478,missing_coordinates:2035}:{total:1},
      all:async()=>({results:[row]})
    };
  }};
  const key="admin-secret-key-that-is-longer-than-32";
  const response=await worker.fetch(new Request("https://worker.test/api/v1/admin/directory/candidates?area=ibb&limit=20",{headers:{Authorization:"Bearer "+key}}),{DB:db,ADMIN_API_KEY:key});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.total,1);
  assert.equal(body.summary.total,3029);
  assert.equal(body.summary.inside_ibb,516);
  assert.equal(body.items[0].id,"gmaps-test");
  assert.equal(body.has_more,false);
});


test("store listing applies an optional neighbourhood filter through bound SQL parameters",async()=>{
  let captured;
  const DB={prepare(sql){return {sql,params:[],bind(...params){this.params=params;captured=this;return this;},all:async()=>({results:[{id:"store-1",name:"متجر الظهار",category:"بقالة",description:"",neighborhood:"الظهار",latitude:13.96,longitude:44.17,owner_verified:0,status:"APPROVED",created_at:"2026-11-09",updated_at:"2026-11-09"}]})};}};
  const response=await worker.fetch(new Request("https://worker.test/api/v1/stores?q=%D9%85%D8%AA%D8%AC%D8%B1&neighborhood=%D8%A7%D9%84%D8%B8%D9%87%D8%A7%D8%B1"),{DB});
  assert.equal(response.status,200);
  assert.match(captured.sql,/instr\(neighborhood_norm,\?\)>0/);
  assert.deepEqual(captured.params.slice(0,4),["متجر","متجر","متجر","متجر"]);
  assert.deepEqual(captured.params.slice(4,6),["الظهار","الظهار"]);
  assert.equal((await response.json()).items[0].neighborhood,"الظهار");
});

test("product listing filters by the approved store neighbourhood and exposes the store area",async()=>{
  let captured;
  const DB={prepare(sql){return {sql,params:[],bind(...params){this.params=params;captured=this;return this;},all:async()=>({results:[{id:"product-1",store_id:"store-1",store_name:"متجر الظهار",store_neighborhood:"الظهار",name:"أرز",category:"مواد غذائية",description:"",price:1200,currency:"YER",image_url:"",created_at:"2026-11-09"}]})};}};
  const response=await worker.fetch(new Request("https://worker.test/api/v1/products?q=%D8%A3%D8%B1%D8%B2&neighborhood=%D8%A7%D9%84%D8%B8%D9%87%D8%A7%D8%B1"),{DB});
  assert.equal(response.status,200);
  assert.match(captured.sql,/instr\(s\.neighborhood_norm,\?\)>0/);
  assert.deepEqual(captured.params.slice(0,4),["أرز","أرز","أرز","أرز"]);
  assert.deepEqual(captured.params.slice(6,8),["الظهار","الظهار"]);
  const product=(await response.json()).items[0];
  assert.equal(product.store_neighborhood,"الظهار");
});


function visibilityDb(statements, firstValue = null) {
  return {
    prepare(sql) {
      statements.push(sql);
      return {
        bind() { return this; },
        all: async () => ({ results: [] }),
        first: async () => firstValue
      };
    }
  };
}

test("public directory map, detail and suggestions require is_public=1", async () => {
  const statements = [];
  const DB = visibilityDb(statements);
  const map = await worker.fetch(new Request(
    "https://worker.test/api/v1/map/places?bbox=44.05,13.82,44.32,14.08&zoom=20"
  ), { DB });
  assert.equal(map.status, 200);
  assert.match(statements[0], /is_public=1/);

  const detail = await worker.fetch(new Request(
    "https://worker.test/api/v1/map/places/gmaps-test"
  ), { DB });
  assert.equal(detail.status, 404);
  assert.match(statements[1], /is_public=1/);

  const suggestions = await worker.fetch(new Request(
    "https://worker.test/api/v1/map/places/gmaps-test/catalog-suggestions"
  ), { DB });
  assert.equal(suggestions.status, 404);
  assert.match(statements[2], /is_public=1/);
});

test("published place statistics count only explicitly public records", async () => {
  const statements = [];
  const DB = visibilityDb(statements, { total: 0 });
  const key = "admin-secret-key-that-is-longer-than-32";
  const response = await worker.fetch(new Request(
    "https://worker.test/api/v1/admin/catalog/stats",
    { headers: { Authorization: "Bearer " + key } }
  ), { DB, ADMIN_API_KEY: key });
  assert.equal(response.status, 200);
  const publishedQuery = statements.find((sql) => sql.includes("visibility_status='PUBLISHED'"));
  assert.ok(publishedQuery);
  assert.match(publishedQuery, /is_public=1/);
});


test("public map output omits unverified email, website and machine-readable descriptions", async () => {
  const row = {
    id: "public-test",
    name: "بقالة الاختبار",
    kind: "BUSINESS",
    category: "بقالة",
    address: "إب، اليمن",
    district: "إب",
    neighborhood: "الظهار",
    phone: "+967700000000",
    email: "abc@xyz.com",
    website_url: "http://www.amgad.com/",
    description: "[{\"id\":\"accessibility\"}]",
    cover_image_url: null,
    opening_hours_json: "{}",
    rating: null,
    review_count: 0,
    operational_status: "UNKNOWN",
    source_name: "Google Maps",
    source_category: "Grocery store",
    plus_code: null,
    osm_source_id: null,
    latitude: 13.9,
    longitude: 44.18,
    location_precision: "ROOFTOP",
    geometry_type: null,
    geometry_json: null,
    maps_url: "https://www.google.com/maps/?q=13.9,44.18",
    is_commercial: 1
  };
  const DB = {
    prepare() {
      return {
        bind() { return this; },
        all: async () => ({ results: [row] })
      };
    }
  };
  const response = await worker.fetch(new Request(
    "https://worker.test/api/v1/map/places?bbox=43.5,13.7,45.0,14.47&zoom=20&limit=500"
  ), { DB });
  assert.equal(response.status, 200);
  const data = await response.json();
  const item = data.items[0];
  assert.equal(data.api_version, "3");
  assert.equal(item.description, null);
  assert.equal(Object.hasOwn(item, "email"), false);
  assert.equal(Object.hasOwn(item, "website_url"), false);
});


test("map endpoint accepts a wide viewport needed for the full governorate on desktop", async () => {
  const DB = {
    prepare() {
      return {
        bind() { return this; },
        all: async () => ({ results: [] })
      };
    }
  };
  const response = await worker.fetch(new Request(
    "https://worker.test/api/v1/map/places?bbox=43.0,13.5,45.5,14.5&zoom=9&limit=500"
  ), { DB });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.api_version, "3");
  assert.deepEqual(data.items, []);
});


test("admin marketplace filters validate type/status and parameterize Arabic search",()=>{
  const store=buildAdminMarketplaceFilter(new URL("https://local.test/?type=STORE&status=SUSPENDED&q=%D8%A8%D9%82%D8%A7%D9%84%D8%A9&limit=900&offset=90000"));
  assert.equal(store.type,"STORE"); assert.equal(store.status,"SUSPENDED"); assert.equal(store.limit,100); assert.equal(store.offset,10000);
  assert.match(store.whereSql,/status=\?/); assert.deepEqual(store.values,["SUSPENDED","بقالة","بقالة","بقالة"]);
  const product=buildAdminMarketplaceFilter(new URL("https://local.test/?type=PRODUCT&status=ACTIVE&q=%D8%A3%D8%B1%D8%B2"));
  assert.match(product.whereSql,/p\.status=\?/); assert.match(product.whereSql,/s\.name_norm/); assert.equal(product.values.length,5);
  assert.throws(()=>buildAdminMarketplaceFilter(new URL("https://local.test/?type=STORE&status=ACTIVE")));
  assert.throws(()=>buildAdminMarketplaceFilter(new URL("https://local.test/?type=MAP")));
});

test("admin marketplace status changes require an allowed state and a reason",()=>{
  assert.deepEqual(adminMarketplaceStatusInput("STORE",{status:"suspended",reason:"مخالفة موثقة"}),{status:"SUSPENDED",reason:"مخالفة موثقة"});
  assert.deepEqual(adminMarketplaceStatusInput("PRODUCT",{status:"active",reason:"تمت المراجعة"}),{status:"ACTIVE",reason:"تمت المراجعة"});
  assert.throws(()=>adminMarketplaceStatusInput("STORE",{status:"ACTIVE",reason:"سبب صحيح"}));
  assert.throws(()=>adminMarketplaceStatusInput("PRODUCT",{status:"SUSPENDED",reason:"لا"}));
});

test("admin marketplace summary, entity list and status writes require the admin key",async()=>{
  const key="admin-secret-key-that-is-longer-than-32";
  const DB={prepare(){throw new Error("database must not be queried without admin auth");}};
  for (const [path,method,body] of [
    ["/api/v1/admin/marketplace/summary","GET"],
    ["/api/v1/admin/marketplace/entities?type=STORE","GET"],
    ["/api/v1/admin/marketplace/stores/123e4567-e89b-42d3-a456-426614174000/status","POST",{status:"SUSPENDED",reason:"سبب إداري"}]
  ]) {
    const response=await worker.fetch(new Request("https://worker.test"+path,{method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined}),{DB,ADMIN_API_KEY:key});
    assert.equal(response.status,401);
    assert.equal((await response.json()).error,"UNAUTHORIZED");
  }
});

test("admin marketplace listing exposes owner verification separately from store publication status",async()=>{
  let captured;
  const DB={prepare(sql){return {sql,params:[],bind(...params){this.params=params;captured=this;return this;},first:async()=>({total:1}),all:async()=>({results:[{id:"store-1",name:"متجر إب",category:"بقالة",neighborhood:"الظهار",status:"SUSPENDED",owner_verified:0,created_at:"2026-11-15",updated_at:"2026-11-15"}]})};}};
  const key="admin-secret-key-that-is-longer-than-32";
  const response=await worker.fetch(new Request("https://worker.test/api/v1/admin/marketplace/entities?type=STORE&status=SUSPENDED&q=%D8%A5%D8%A8",{headers:{Authorization:"Bearer "+key}}),{DB,ADMIN_API_KEY:key});
  assert.equal(response.status,200); const data=await response.json();
  assert.equal(data.total,1); assert.equal(data.items[0].status,"SUSPENDED"); assert.equal(data.items[0].owner_verified,false);
  assert.deepEqual(captured.params,["SUSPENDED","إب","إب","إب",50,0]);
});

test("admin store suspension writes an audit row atomically with the conditional status update",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",key="admin-secret-key-that-is-longer-than-32"; let batchStatements=[];
  const DB={prepare(sql){return {sql,params:[],bind(...params){this.params=params;return this;},first:async()=>sql.includes("SELECT id,status FROM stores")?{id,status:"APPROVED"}:sql.includes("SELECT id FROM admin_audit_log")?{id:"audit"}:null,all:async()=>({results:[]})};},batch:async(statements)=>{batchStatements=statements;return [];}};
  const response=await worker.fetch(new Request("https://worker.test/api/v1/admin/marketplace/stores/"+id+"/status",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({status:"SUSPENDED",reason:"مخالفة موثقة"})}),{DB,ADMIN_API_KEY:key});
  assert.equal(response.status,200); const data=await response.json(); assert.equal(data.status,"SUSPENDED"); assert.equal(data.action,"SUSPEND");
  assert.equal(batchStatements.length,2); assert.match(batchStatements[0].sql,/UPDATE stores SET status/); assert.match(batchStatements[0].sql,/AND status=\?/); assert.match(batchStatements[1].sql,/admin_audit_log/); assert.match(batchStatements[1].sql,/changes\(\)=1/);
});

test("a product cannot be reactivated while its parent store is suspended",async()=>{
  const id="123e4567-e89b-42d3-a456-426614174000",key="admin-secret-key-that-is-longer-than-32"; let batches=0;
  const DB={prepare(sql){return {sql,bind(){return this;},first:async()=>({id,status:"SUSPENDED",store_status:"SUSPENDED"})};},batch:async()=>{batches++;return [];}};
  const response=await worker.fetch(new Request("https://worker.test/api/v1/admin/marketplace/products/"+id+"/status",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({status:"ACTIVE",reason:"تمت المراجعة"})}),{DB,ADMIN_API_KEY:key});
  assert.equal(response.status,409); assert.equal((await response.json()).error,"STORE_NOT_APPROVED"); assert.equal(batches,0);
});


test("admin marketplace summary returns non-map commerce counts only",async()=>{
  const key="admin-secret-key-that-is-longer-than-32";
  const DB={prepare(sql){return {sql,first:async()=>({total:sql.includes("stores WHERE status='SUSPENDED'")?2:sql.includes("products WHERE status='ACTIVE'")?7:sql.includes("submissions WHERE status='PENDING'")?3:0})};}};
  const response=await worker.fetch(new Request("https://worker.test/api/v1/admin/marketplace/summary",{headers:{Authorization:"Bearer "+key}}),{DB,ADMIN_API_KEY:key});
  assert.equal(response.status,200); const summary=(await response.json()).summary;
  assert.equal(summary.stores_suspended,2); assert.equal(summary.products_active,7); assert.equal(summary.submissions_pending,3);
  assert.equal(Object.hasOwn(summary,"directory_places"),false);
});

test("admin marketplace audit endpoint returns only operational audit fields",async()=>{
  const key="admin-secret-key-that-is-longer-than-32"; let countParams,rowsParams;
  const DB={prepare(sql){return {sql,bind(...params){if(sql.includes("COUNT(*)"))countParams=params;else rowsParams=params;return this;},first:async()=>({total:1}),all:async()=>({results:[{id:"audit-1",entity_type:"STORE",entity_id:"store-1",action:"SUSPEND",previous_status:"APPROVED",next_status:"SUSPENDED",reason:"سبب موثق",created_at:"2026-11-15T00:00:00Z"}]})};}};
  const response=await worker.fetch(new Request("https://worker.test/api/v1/admin/marketplace/audit?type=STORE&limit=10",{headers:{Authorization:"Bearer "+key}}),{DB,ADMIN_API_KEY:key});
  assert.equal(response.status,200); const data=await response.json();
  assert.equal(data.total,1); assert.equal(data.items[0].action,"SUSPEND"); assert.equal(Object.hasOwn(data.items[0],"actor_fingerprint"),false);
  assert.deepEqual(countParams,["STORE"]); assert.deepEqual(rowsParams,["STORE",10,0]);
});

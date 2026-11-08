import test from "node:test";import assert from "node:assert/strict";import worker, {norm,storeInput,productInput,safeImage,buildDirectoryCandidateFilter} from "../src/index.js";
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

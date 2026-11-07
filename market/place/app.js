(function(){
"use strict";
var API="https://ibb-market-api.aicreativestudio.workers.dev";
var $=function(id){return document.getElementById(id);};
var id=new URLSearchParams(location.search).get("id");
function node(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function addDetail(label,value,href){if(!value)return;var box=node("div","detail-item");box.append(node("small","",label));if(href){var a=node("a","",value);a.href=href;if(href.indexOf("http")===0){a.target="_blank";a.rel="noopener noreferrer";}box.append(a);}else box.append(node("strong","",value));$("detailsGrid").append(box);}
function safeHttp(value){try{var u=new URL(value);return u.protocol==="https:"||u.protocol==="http:"?u.href:"";}catch(_){return "";}}
function kindLabel(kind){return ({BUSINESS:"منشأة تجارية",LANDMARK:"معلم",STREET:"شارع أو طريق",NEIGHBORHOOD:"حي أو حارة",PUBLIC_SERVICE:"خدمة عامة",OTHER:"موقع"})[kind]||"موقع";}
function dayLabel(day){return ({Monday:"الإثنين",Tuesday:"الثلاثاء",Wednesday:"الأربعاء",Thursday:"الخميس",Friday:"الجمعة",Saturday:"السبت",Sunday:"الأحد"})[day]||day;}
function renderHours(hours){var keys=Object.keys(hours||{});if(!keys.length)return;$("hoursSection").hidden=false;keys.sort(function(a,b){var order=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];return order.indexOf(a)-order.indexOf(b);}).forEach(function(day){var row=node("div","hours-row");row.append(node("strong","",dayLabel(day)));var values=Array.isArray(hours[day])?hours[day].join("، "):String(hours[day]);row.append(node("span","",values));$("hoursGrid").append(row);});}
function renderSuggestions(items){if(!items.length)return;$("suggestionsSection").hidden=false;items.forEach(function(p){var card=node("article","suggestion-card");var imageUrl=p.image_url?(p.image_url.indexOf("http")===0?p.image_url:API+p.image_url):"";if(imageUrl){var img=node("img");img.loading="lazy";img.alt="";img.src=imageUrl;img.onerror=function(){img.replaceWith(node("span","suggestion-placeholder","▤"));};card.append(img);}else card.append(node("span","suggestion-placeholder","▤"));var copy=node("div","suggestion-copy");copy.append(node("strong","",p.name));copy.append(node("small","",[p.brand,p.category].filter(Boolean).join(" · ")||"منتج مرجعي"));copy.append(node("em","",p.merchant_confirmed?"أكد التاجر المنتج":"اقتراح مرجعي — لا يعني التوفر"));card.append(copy);$("suggestionsGrid").append(card);});}
function render(place,suggestions){$("status").hidden=true;$("placeHeader").hidden=false;$("detailsSection").hidden=false;$("claimSection").hidden=place.kind!=="BUSINESS";
$("placeName").textContent=place.name||"موقع في مدينة إب";$("kindTag").textContent=kindLabel(place.kind);$("placeCategory").textContent=place.category||"";
$("rating").textContent=Number(place.review_count)>0?"★ "+Number(place.rating||0).toFixed(1)+" · "+Number(place.review_count).toLocaleString("ar")+" تقييم":"لا توجد تقييمات كافية";
var state=place.operational_status==="CLOSED"?"مغلق بحسب بيانات المصدر":place.operational_status==="OPEN"?"مفتوح بحسب بيانات المصدر":"حالة التشغيل غير مؤكدة";
$("operationalStatus").textContent=state+(place.location_precision==="APPROXIMATE"?" · الموقع تقريبي":"");
var cover=safeHttp(place.cover_image_url||"");if(cover){$("coverImage").src=cover;$("coverImage").style.display="block";$("coverFallback").style.display="none";$("coverImage").onerror=function(){$("coverImage").style.display="none";$("coverFallback").style.display="grid";};}
var query=encodeURIComponent(place.latitude+","+place.longitude);var maps=safeHttp(place.maps_url)||"https://www.google.com/maps/search/?api=1&query="+query;
$("mapsLink").href=maps;$("directionsLink").href="https://www.google.com/maps/dir/?api=1&destination="+query;
if(place.phone){var phone=String(place.phone).replace(/[^+0-9]/g,"");$("phoneLink").href="tel:"+phone;$("phoneLink").hidden=false;}
var website=safeHttp(place.website_url);if(website){$("websiteLink").href=website;$("websiteLink").hidden=false;}
addDetail("العنوان",place.address);addDetail("الحي",place.neighborhood);addDetail("المنطقة",place.district);addDetail("الهاتف",place.phone,place.phone?"tel:"+String(place.phone).replace(/[^+0-9]/g,""):"");addDetail("البريد الإلكتروني",place.email,place.email?"mailto:"+place.email:"");addDetail("الموقع الإلكتروني",website,website);addDetail("رمز الموقع Plus Code",place.plus_code);addDetail("مصدر السجل",place.source_name||"خرائط Google");addDetail("دقة الموقع",place.location_precision==="EXACT"?"إحداثيات دقيقة من المصدر":place.location_precision==="APPROXIMATE"?"إحداثيات تقريبية":"غير محددة");
renderHours(place.opening_hours||{});renderSuggestions(suggestions);
var claim=new URL("../merchant/",location.href);claim.searchParams.set("source_place_id",place.id);claim.searchParams.set("name",place.name||"");claim.searchParams.set("category",place.category||"");claim.searchParams.set("neighborhood",place.neighborhood||place.district||"");claim.searchParams.set("latitude",place.latitude);claim.searchParams.set("longitude",place.longitude);$("claimLink").href=claim.toString();
}
if(!id){$("status").textContent="رابط الموقع غير مكتمل. افتح الموقع من الخريطة.";return;}
Promise.all([
 fetch(API+"/api/v1/map/places/"+encodeURIComponent(id),{headers:{Accept:"application/json"}}).then(function(r){if(!r.ok)throw new Error("NOT_FOUND");return r.json();}),
 fetch(API+"/api/v1/map/places/"+encodeURIComponent(id)+"/catalog-suggestions",{headers:{Accept:"application/json"}}).then(function(r){return r.ok?r.json():{items:[]};}).catch(function(){return {items:[]};})
]).then(function(results){if(!results[0].ok||!results[0].item)throw new Error("NOT_FOUND");render(results[0].item,Array.isArray(results[1].items)?results[1].items:[]);}).catch(function(){$("status").textContent="لم نعثر على هذا الموقع في الدليل المنشور. قد يكون الرابط قديمًا أو السجل قيد المراجعة.";});
})();

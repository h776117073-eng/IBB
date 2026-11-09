(function(){
"use strict";
var API="https://ibb-market-api.aicreativestudio.workers.dev";
var NEIGHBORHOOD_KEY="ibb-market-neighborhood-v1";
function normalizeNeighborhood(value){return String(value||"").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,80);}
function readNeighborhood(){try{return normalizeNeighborhood(localStorage.getItem(NEIGHBORHOOD_KEY)||"");}catch(_){return "";}}
function writeNeighborhood(value){try{if(value)localStorage.setItem(NEIGHBORHOOD_KEY,value);else localStorage.removeItem(NEIGHBORHOOD_KEY);}catch(_){}}
var refreshSequence=0,searchTimer=0;
var state={stores:[],products:[],query:"",category:"",selectedStore:"",neighborhood:readNeighborhood(),cart:[]};
var $=function(id){return document.getElementById(id);};
var storeGrid=$("storeGrid"),productGrid=$("productGrid"),productCount=$("productCount");
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function money(value,currency){if(value==null||value==="")return "السعر عند المتجر";var n=Number(value);if(!Number.isFinite(n))return "السعر عند المتجر";return new Intl.NumberFormat("ar-YE",{maximumFractionDigits:0}).format(n)+" "+(currency==="YER"?"ر.ي":esc(currency||""));}
function toast(message){var el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(function(){el.classList.remove("show");},2400);}
function empty(title,desc,icon){return '<div class="empty-state"><span>'+icon+'</span><strong>'+esc(title)+'</strong><p>'+esc(desc)+'</p></div>';}
function api(path){return fetch(API+path,{method:"GET",headers:{Accept:"application/json"},mode:"cors",cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();});}
function renderStores(){
 var query=state.query.trim().toLocaleLowerCase("ar");
 var rows=state.stores.filter(function(s){return !query||[s.name,s.category,s.neighborhood].some(function(v){return String(v||"").toLocaleLowerCase("ar").indexOf(query)>=0;});});
 if(!rows.length){storeGrid.innerHTML=empty(state.query?"لا توجد متاجر مطابقة":"لا توجد متاجر منشورة بعد",state.query?"جرّب كلمة أخرى أو امسح البحث.":"عند اعتماد أول متجر ستظهر بياناته هنا. أسماء الدليل القديم لا تُعامل تلقائياً كمتاجر عاملة أو ذات مخزون.","⌂");return;}
 storeGrid.innerHTML=rows.map(function(s){
  var verified=s.owner_verified===true;
  var location=[s.category,s.neighborhood].filter(Boolean).map(esc).join(" · ");
  return '<article class="store-card" role="button" tabindex="0" data-store="'+esc(s.id)+'" aria-label="افتح متجر '+esc(s.name)+'"><div class="store-avatar">⌂</div><div class="store-info"><h3>'+esc(s.name)+'</h3><p>'+(location||"مدينة إب")+'</p><span class="verified-chip">✓ '+(verified?"تم التحقق من الملكية":"تمت مراجعة بيانات السجل")+'</span></div><span class="store-arrow" aria-hidden="true">‹</span></article>';
 }).join("");
}
function productIcon(category){var c=String(category||"");if(/خض|ورق/i.test(c))return "♧";if(/فاك/i.test(c))return "◉";if(/مخب|خبز/i.test(c))return "⌂";if(/منزل/i.test(c))return "⌂";return "▤";}
function renderProducts(){
 var rows=state.products.filter(function(p){
  var c=String(p.category||"");
  var catOk=!state.category||c.indexOf(state.category)>=0||((state.category==="بقالة")&&(!c||/غذ|مواد/i.test(c)));
  var storeOk=!state.selectedStore||String(p.store_id)===state.selectedStore;
  var query=state.query.trim().toLocaleLowerCase("ar");
  var textOk=!query||[p.name,p.category,p.store_name].some(function(x){return String(x||"").toLocaleLowerCase("ar").indexOf(query)>=0;});
  return catOk&&storeOk&&textOk;
 });
 productCount.textContent=rows.length+" منتج";
 if(!rows.length){productGrid.innerHTML=empty(state.query?"لا توجد نتائج مطابقة":"لم تُنشر منتجات بعد",state.query?"جرّب كلمة أخرى أو امسح الفلاتر.":"ستظهر هنا المنتجات التي يضيفها التجار ويتم اعتمادها. لا نعرض منتجات افتراضية أو مخزوناً غير مؤكد.","▤");return;}
 productGrid.innerHTML=rows.map(function(p){
  var image=p.image_url&&/^https:\/\//i.test(p.image_url)?'<img loading="lazy" src="'+esc(p.image_url)+'" alt="" onerror="this.remove()">':'<span class="product-fallback">'+productIcon(p.category)+'</span>';
  var cat=p.category?'<span class="product-category">'+esc(p.category)+'</span>':"";
  return '<article class="product-card"><button type="button" class="product-open" data-details="'+esc(p.id)+'" aria-label="تفاصيل '+esc(p.name)+'"><div class="product-media">'+image+cat+'</div><div class="product-body"><h3>'+esc(p.name)+'</h3><div class="product-store">'+esc(p.store_name||"متجر محلي")+'</div></div></button><div class="product-price-row"><span class="product-price">'+money(p.price,p.currency)+'</span><button class="add-button" type="button" data-add="'+esc(p.id)+'" aria-label="أضف '+esc(p.name)+' إلى السلة التجريبية">+</button></div></article>';
 }).join("");
}
function renderFilters(){
 var el=$("activeFilters"),bits=[];
 if(state.query)bits.push('<button class="filter-pill" type="button" data-clear="query">البحث: '+esc(state.query)+' ×</button>');
 if(state.neighborhood)bits.push('<button class="filter-pill" type="button" data-clear="area">الحي: '+esc(state.neighborhood)+' ×</button>');
 if(state.category)bits.push('<button class="filter-pill" type="button" data-clear="category">الفئة: '+esc(state.category)+' ×</button>');
 if(state.selectedStore)bits.push('<button class="filter-pill" type="button" data-clear="store">إلغاء تصفية المتجر ×</button>');
 el.innerHTML=bits.join("");
}
function render(){renderStores();renderProducts();renderFilters();}
function refresh(){
 var requestSequence=++refreshSequence;
 var neighborhoodQuery=state.neighborhood?"&neighborhood="+encodeURIComponent(state.neighborhood):"";
 var searchQuery=state.query?"&q="+encodeURIComponent(state.query):"";
 var filters=neighborhoodQuery+searchQuery;
 Promise.all([api("/api/v1/stores?limit=100"+filters),api("/api/v1/products?limit=100"+filters)]).then(function(res){
  if(requestSequence!==refreshSequence)return;
  state.stores=Array.isArray(res[0].items)?res[0].items:[];
  state.products=Array.isArray(res[1].items)?res[1].items:[];
  render();
 }).catch(function(){
  if(requestSequence!==refreshSequence)return;
  state.stores=[];state.products=[];
  storeGrid.innerHTML=empty("تعذر الاتصال ببيانات السوق","تحقق من الاتصال بالإنترنت ثم أعد تحميل الصفحة. لن نستبدل البيانات الحقيقية بعروض تجريبية.","⌁");
  productGrid.innerHTML=empty("المنتجات غير متاحة الآن","تعذر جلب المنتجات المعتمدة من الخادم.","⌁");
  productCount.textContent="غير متاح";
 });
}
function updateLocationLabel(){
 var button=$("locationButton");
 button.querySelector("small").textContent=state.neighborhood?"حي التسوق":"منطقة التسوق";
 button.querySelector("strong").textContent=state.neighborhood||"مدينة إب";
 button.setAttribute("aria-label",state.neighborhood?"منطقة التسوق: "+state.neighborhood:"منطقة التسوق: مدينة إب");
}
function applyNeighborhood(value){
 state.neighborhood=normalizeNeighborhood(value);
 writeNeighborhood(state.neighborhood);
 state.selectedStore="";
 updateLocationLabel();
 renderFilters();
 refresh();
 toast(state.neighborhood?"تم تطبيق تصفية حي "+state.neighborhood:"تم عرض مدينة إب دون تصفية الحي");
}
function syncCategory(){document.querySelectorAll(".category-tile").forEach(function(b){b.classList.toggle("selected",b.dataset.category===state.category);});}
function addToCart(id){
 var p=state.products.find(function(x){return String(x.id)===String(id);});if(!p)return;
 var found=state.cart.find(function(x){return String(x.id)===String(id);});
 if(found)found.quantity+=1;else state.cart.push({id:p.id,name:p.name,store_name:p.store_name,price:p.price,currency:p.currency,quantity:1});
 renderCart();toast("أُضيف المنتج إلى السلة التجريبية");
}
function changeQty(id,delta){
 var item=state.cart.find(function(x){return String(x.id)===String(id);});if(!item)return;
 item.quantity+=delta;if(item.quantity<=0)state.cart=state.cart.filter(function(x){return String(x.id)!==String(id);});
 renderCart();
}
function renderCart(){
 var count=state.cart.reduce(function(a,x){return a+x.quantity;},0);
 $("cartCount").textContent=count;$("mobileCartCount").textContent=count;
 if(!state.cart.length){$("cartItems").innerHTML=empty("سلتك فارغة","أضف منتجاً من قائمة المنتجات لتراه هنا.","▱");$("cartTotal").textContent="0 ر.ي";$("clearCart").disabled=true;return;}
 var total=0,known=true;
 $("cartItems").innerHTML=state.cart.map(function(x){
  if(x.price==null||!Number.isFinite(Number(x.price)))known=false;else total+=Number(x.price)*x.quantity;
  return '<div class="cart-row"><div class="store-avatar">▤</div><div><strong>'+esc(x.name)+'</strong><small>'+esc(x.store_name||"متجر محلي")+'</small></div><div class="cart-qty"><button type="button" data-qty="-1" data-id="'+esc(x.id)+'" aria-label="تقليل الكمية">−</button><b>'+x.quantity+'</b><button type="button" data-qty="1" data-id="'+esc(x.id)+'" aria-label="زيادة الكمية">+</button></div></div>';
 }).join("");
 $("cartTotal").textContent=known?money(total,"YER"):"لا يمكن حسابه بدقة";
 $("clearCart").disabled=false;
}
function openProduct(id){
 var p=state.products.find(function(x){return String(x.id)===String(id);});if(!p)return;
 $("detailTitle").textContent="تفاصيل المنتج";
 var image=p.image_url&&/^https:\/\//i.test(p.image_url)?'<img class="detail-image" src="'+esc(p.image_url)+'" alt="'+esc(p.name)+'">':'<div class="detail-image detail-placeholder">'+productIcon(p.category)+'</div>';
 $("detailContent").innerHTML='<div class="product-detail">'+image+'<div class="product-detail-copy"><span class="eyebrow">'+esc(p.category||"منتج محلي")+'</span><h3>'+esc(p.name)+'</h3><p>'+esc(p.description||"لم يضف المتجر وصفًا لهذا المنتج.")+'</p><div class="detail-store">المتجر: '+esc(p.store_name||"غير محدد")+'</div><strong class="detail-price">'+money(p.price,p.currency)+'</strong><button class="submit-button" type="button" data-add="'+esc(p.id)+'">أضف إلى السلة التجريبية <span>+</span></button><small>السعر والتوفر يحتاجان تأكيد المتجر قبل أي شراء. هذه المعاينة لا تنشئ طلبًا.</small></div></div>';
 $("detailDialog").showModal();
}
function openStore(id){
 var store=state.stores.find(function(x){return String(x.id)===String(id);});if(!store)return;
 $("detailTitle").textContent="ملف المتجر";
 $("detailContent").innerHTML='<div class="detail-loading"><span class="loader"></span> جارٍ تحميل منتجات المتجر…</div>';
 $("detailDialog").showModal();
 Promise.all([
  api("/api/v1/stores/"+encodeURIComponent(id)+"/products"),
  api("/api/v1/stores/"+encodeURIComponent(id)+"/catalog-suggestions").catch(function(){return {items:[]};})
 ]).then(function(results){
  var data=results[0],suggestionData=results[1]||{items:[]};
  if(data.store)store=data.store;
  var products=Array.isArray(data.products)?data.products:[];
  products.forEach(function(p){if(!state.products.some(function(x){return String(x.id)===String(p.id);}))state.products.push(p);});
  var suggestions=Array.isArray(suggestionData.items)?suggestionData.items:[];
  var suggestionRows=suggestions.map(function(p){
   var image=p.image_url?((/^https:\/\//i.test(p.image_url)?p.image_url:API+p.image_url)):"";
   var visual=image?'<img loading="lazy" src="'+esc(image)+'" alt="" onerror="this.remove()">':'<span class="catalog-suggestion-placeholder">▤</span>';
   return '<article class="catalog-suggestion-card">'+visual+'<div><b>'+esc(p.name)+'</b><small>'+esc(p.category||"منتج مرجعي")+'</small></div><span class="catalog-suggestion-tag">'+(p.merchant_confirmed?"أكد المتجر":"اقتراح")+'</span></article>';
  }).join("");
  var suggestionSection=suggestions.length?'<section class="catalog-suggestions"><h4>منتجات مناسبة من المكتبة المرجعية</h4><p>اقتراحات حسب نشاط المتجر، وليست مخزونًا أو توفرًا مؤكدًا. لا يمكن شراؤها قبل اعتماد التاجر وإضافة السعر.</p><div class="catalog-suggestion-grid">'+suggestionRows+'</div></section>':"";
  var verified=store.owner_verified===true;
  var rows=products.length?products.map(function(p){return '<div class="detail-product"><div><b>'+esc(p.name)+'</b><small>'+esc(p.category||"منتج محلي")+' · '+money(p.price,p.currency)+'</small></div><button type="button" class="detail-add" data-add="'+esc(p.id)+'" aria-label="أضف '+esc(p.name)+'">+</button></div>';}).join(""):empty("لا توجد منتجات منشورة بعد","تظهر المنتجات هنا بعد أن يضيفها المتجر وتعتمدها الإدارة.","▤");
  $("detailContent").innerHTML='<div class="store-detail"><div class="store-detail-heading"><div class="store-avatar large">⌂</div><div><h3>'+esc(store.name)+'</h3><p>'+esc([store.category,store.neighborhood].filter(Boolean).join(" · ")||"مدينة إب")+'</p><span class="verified-chip">✓ '+(verified?"تم التحقق من الملكية":"تمت مراجعة بيانات السجل")+'</span></div></div><p class="store-description">'+esc(store.description||"لا يوجد وصف إضافي للمتجر.")+'</p><button type="button" class="filter-pill store-filter-action" data-filter-store="'+esc(store.id)+'">عرض منتجات هذا المتجر في القائمة</button><h4>منتجات المتجر</h4><div class="store-detail-products">'+rows+'</div>'+suggestionSection+'</div>';
 }).catch(function(){
  $("detailContent").innerHTML='<div class="store-detail">'+empty("تعذر تحميل كتالوج المتجر","تحقق من الاتصال ثم حاول مجددًا.","⌁")+'</div>';
 });
}
function openCart(){renderCart();$("cartDialog").showModal();}
$("searchForm").addEventListener("submit",function(e){e.preventDefault();state.query=$("searchInput").value.trim();state.selectedStore="";render();refresh();$("products").scrollIntoView({behavior:"smooth"});});
$("searchInput").addEventListener("input",function(){state.query=this.value.trim();state.selectedStore="";renderStores();renderProducts();renderFilters();if(searchTimer)clearTimeout(searchTimer);searchTimer=setTimeout(refresh,320);});
document.querySelectorAll("[data-query]").forEach(function(b){b.addEventListener("click",function(){state.query=this.dataset.query;$("searchInput").value=state.query;render();refresh();$("products").scrollIntoView({behavior:"smooth"});});});
$("categoryGrid").addEventListener("click",function(e){var b=e.target.closest("[data-category]");if(!b)return;state.category=b.dataset.category||"";syncCategory();renderProducts();renderFilters();});
$("productGrid").addEventListener("click",function(e){var add=e.target.closest("[data-add]");if(add){addToCart(add.dataset.add);return;}var details=e.target.closest("[data-details]");if(details)openProduct(details.dataset.details);});
function chooseStore(card){openStore(card.dataset.store);}
$("storeGrid").addEventListener("click",function(e){var card=e.target.closest("[data-store]");if(card)chooseStore(card);});
$("storeGrid").addEventListener("keydown",function(e){var card=e.target.closest("[data-store]");if(card&&(e.key==="Enter"||e.key===" ")){e.preventDefault();chooseStore(card);}});
$("detailContent").addEventListener("click",function(e){var add=e.target.closest("[data-add]");if(add){addToCart(add.dataset.add);return;}var filter=e.target.closest("[data-filter-store]");if(filter){state.selectedStore=String(filter.dataset.filterStore);$("detailDialog").close();renderProducts();renderFilters();$("products").scrollIntoView({behavior:"smooth"});}});
$("closeDetails").addEventListener("click",function(){$("detailDialog").close();});
$("detailDialog").addEventListener("click",function(e){if(e.target===$("detailDialog"))$("detailDialog").close();});
$("activeFilters").addEventListener("click",function(e){var b=e.target.closest("[data-clear]");if(!b)return;var k=b.dataset.clear;if(k==="query"){state.query="";$("searchInput").value="";}if(k==="category"){state.category="";syncCategory();}if(k==="store")state.selectedStore="";if(k==="area"){state.neighborhood="";writeNeighborhood("");updateLocationLabel();}render();if(k==="area"||k==="query")refresh();});
$("cartButton").addEventListener("click",openCart);$("mobileCartButton").addEventListener("click",openCart);$("closeCart").addEventListener("click",function(){$("cartDialog").close();});
$("cartDialog").addEventListener("click",function(e){if(e.target===$("cartDialog"))$("cartDialog").close();});
$("cartItems").addEventListener("click",function(e){var b=e.target.closest("[data-qty]");if(b)changeQty(b.dataset.id,Number(b.dataset.qty));});
$("clearCart").addEventListener("click",function(){state.cart=[];renderCart();toast("تم إفراغ السلة");});
$("locationButton").addEventListener("click",function(){
 $("neighborhoodInput").value=state.neighborhood;
 $("locationDialog").showModal();
 $("neighborhoodInput").focus();
});
$("locationForm").addEventListener("submit",function(event){event.preventDefault();applyNeighborhood($("neighborhoodInput").value);$("locationDialog").close();});
$("clearLocation").addEventListener("click",function(){$("neighborhoodInput").value="";applyNeighborhood("");$("locationDialog").close();});
$("closeLocation").addEventListener("click",function(){$("locationDialog").close();});
$("locationDialog").addEventListener("click",function(event){if(event.target===$("locationDialog"))$("locationDialog").close();});
updateLocationLabel();renderCart();refresh();
window.IBBMarket={refresh:refresh,getState:function(){return {stores:state.stores.length,products:state.products.length,cart:state.cart.length,neighborhood:state.neighborhood};}};
})();
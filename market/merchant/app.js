(function(){
"use strict";
var API="https://ibb-market-api.aicreativestudio.workers.dev";
var $=function(id){return document.getElementById(id);};
function toast(message){var el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(function(){el.classList.remove("show");},3200);}
function uuid(){
 if(window.crypto&&typeof window.crypto.randomUUID==="function")return window.crypto.randomUUID();
 return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==="x"?r:(r&3|8)).toString(16);});
}
function setResult(kind,title,message,id){
 var el=$("submissionResult");
 el.className="result"+(kind==="error"?" error":"");
 el.innerHTML="<strong>"+escapeHtml(title)+"</strong><p>"+escapeHtml(message)+"</p>"+(id?"<code>"+escapeHtml(id)+"</code>":"");
 el.classList.remove("hidden");
 el.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function escapeHtml(value){return String(value==null?"":value).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function switchPanel(panelId){
 document.querySelectorAll(".tab").forEach(function(tab){
  var active=tab.dataset.panel===panelId;
  tab.classList.toggle("active",active);
  tab.setAttribute("aria-selected",active?"true":"false");
  tab.tabIndex=active?0:-1;
 });
 document.querySelectorAll(".panel").forEach(function(panel){panel.classList.toggle("hidden",panel.id!==panelId);});
 $("submissionResult").classList.add("hidden");
}
document.querySelectorAll(".tab").forEach(function(tab){
 tab.addEventListener("click",function(){switchPanel(tab.dataset.panel);});
});

var registrationParams=new URLSearchParams(location.search);
if(registrationParams.get("name")){
 switchPanel("storePanel");
 var registrationForm=$("storeForm");
 registrationForm.elements.namedItem("name").value=registrationParams.get("name")||"";
 var rawCategory=(registrationParams.get("category")||"").toLowerCase();
 var categoryMap={
  "grocery store":"بقالة","convenience store":"بقالة","supermarket":"مواد غذائية","market":"مواد غذائية",
  "pharmacy":"صيدلية","clothing store":"ملابس","electronics store":"أجهزة وإلكترونيات",
  "bakery":"مخبوزات","baker":"مخبوزات","fruit and vegetable store":"خضروات وفواكه",
  "home goods store":"منزل وأدوات","hardware store":"منزل وأدوات"
 };
 var mappedCategory=categoryMap[rawCategory]||registrationParams.get("category")||"أخرى";
 var categoryField=registrationForm.elements.namedItem("category");
 if(Array.from(categoryField.options).some(function(o){return o.value===mappedCategory||o.text===mappedCategory;}))categoryField.value=mappedCategory;
 else categoryField.value="أخرى";
 registrationForm.elements.namedItem("neighborhood").value=registrationParams.get("neighborhood")||"";
 registrationForm.elements.namedItem("latitude").value=registrationParams.get("latitude")||"";
 registrationForm.elements.namedItem("longitude").value=registrationParams.get("longitude")||"";
 $("locationHelp").textContent="تمت تعبئة الاسم والفئة والإحداثيات من صفحة الدليل. راجع الموقع وتأكد من بيانات المتجر قبل الإرسال.";
}

function value(form,name){var field=form.elements.namedItem(name);return field?String(field.value||"").trim():"";}
function showButtonState(button,busy,label){
 if(!button.dataset.originalText)button.dataset.originalText=button.innerHTML;
 button.disabled=busy;
 button.innerHTML=busy?"جارٍ الإرسال…":(label||button.dataset.originalText);
}
async function submit(path,payload,button){
 showButtonState(button,true);
 $("submissionResult").classList.add("hidden");
 try{
  var response=await fetch(API+path,{
   method:"POST",
   mode:"cors",
   cache:"no-store",
   headers:{"Accept":"application/json","Content-Type":"application/json","Idempotency-Key":uuid()},
   body:JSON.stringify(payload)
  });
  var data={};try{data=await response.json();}catch(_){}
  if(!response.ok){
   var message=data.message||data.error||("HTTP "+response.status);
   var guidance="";
   if(response.status===409)guidance="قد يكون المتجر غير معتمد بعد أو توجد مساهمة مماثلة. راجع الاسم والحي ثم حاول بعد معالجة السبب.";
   else if(response.status===429)guidance="بلغت طلبات هذا الاتصال الحد اليومي. أعد المحاولة لاحقًا.";
   else if(response.status===400)guidance="راجع الحقول المطلوبة وصحة الإحداثيات والرابط.";
   throw new Error(message+(guidance?" — "+guidance:""));
  }
  var record=data.submission||{};
  var status=record.status||"PENDING";
  setResult("success","وصلت مساهمتك إلى قائمة المراجعة","حالة المساهمة: "+status+". لن تظهر للعامة حتى تراجعها الإدارة وتوافق عليها.",record.id||"");
  toast("تم إرسال المساهمة للمراجعة");
  return true;
 }catch(error){
  var message=error&&error.message?error.message:"تعذر إرسال المساهمة.";
  setResult("error","لم يتم تأكيد الإرسال",message+" لم تُعرض هذه الصفحة نجاحًا غير مؤكد؛ تحقق من الاتصال قبل إعادة المحاولة.");
  toast("تعذر تأكيد الإرسال");
  return false;
 }finally{showButtonState(button,false);}
}
$("storeForm").addEventListener("submit",async function(event){
 event.preventDefault();
 var form=event.currentTarget;
 if(!form.reportValidity())return;
 var latitude=Number(value(form,"latitude")),longitude=Number(value(form,"longitude"));
 if(!Number.isFinite(latitude)||latitude < -90||latitude>90||!Number.isFinite(longitude)||longitude < -180||longitude>180){
  setResult("error","الإحداثيات غير صحيحة","أدخل خط عرض بين ‎-90 و90‎ وخط طول بين ‎-180 و180‎.");
  return;
 }
 var payload={
  name:value(form,"name"),
  category:value(form,"category"),
  description:value(form,"description"),
  neighborhood:value(form,"neighborhood"),
  latitude:latitude,
  longitude:longitude
 };
 var button=form.querySelector('button[type="submit"]');
 var ok=await submit("/api/v1/submissions/stores",payload,button);
 if(ok)form.reset();
});
$("productForm").addEventListener("submit",async function(event){
 event.preventDefault();
 var form=event.currentTarget;
 if(!form.reportValidity())return;
 var priceRaw=value(form,"price"),price=null;
 if(priceRaw!==""){
  price=Number(priceRaw);
  if(!Number.isFinite(price)||price<0||price>1e11){
   setResult("error","السعر غير صحيح","أدخل سعرًا رقميًا موجبًا أو اترك الحقل فارغًا.");
   return;
  }
 }
 var image=value(form,"image_url");
 if(image){
  try{var parsed=new URL(image);if(parsed.protocol!=="https:")throw new Error();}
  catch(_){setResult("error","رابط الصورة غير صالح","استخدم رابط صورة عام يبدأ بـ https:// أو اترك الحقل فارغًا.");return;}
 }
 var payload={
  store_name:value(form,"store_name"),
  store_neighborhood:value(form,"store_neighborhood"),
  name:value(form,"name"),
  price:price,
  category:value(form,"category"),
  description:value(form,"description"),
  image_url:image
 };
 var button=form.querySelector('button[type="submit"]');
 var ok=await submit("/api/v1/submissions/products",payload,button);
 if(ok)form.reset();
});
$("useLocation").addEventListener("click",function(){
 var button=this,help=$("locationHelp");
 if(!navigator.geolocation){help.textContent="المتصفح لا يدعم تحديد الموقع. أدخل الإحداثيات يدويًا.";return;}
 button.disabled=true;button.textContent="جارٍ تحديد الموقع…";help.textContent="طلبنا إذن الموقع بعد ضغطك على الزر. قرّب جهازك من مدخل المتجر للحصول على إحداثيات أدق.";
 navigator.geolocation.getCurrentPosition(function(position){
  $("storeForm").elements.namedItem("latitude").value=position.coords.latitude.toFixed(6);
  $("storeForm").elements.namedItem("longitude").value=position.coords.longitude.toFixed(6);
  help.textContent="تم ملء الإحداثيات من موقع جهازك. تأكد أنك بجوار المتجر قبل الإرسال.";
  button.disabled=false;button.textContent="⌖ تحديث موقعي";toast("تم تحديد الإحداثيات");
 },function(error){
  var message=error.code===1?"رفضت إذن الموقع. يمكنك إدخال الإحداثيات يدويًا.":error.code===2?"تعذر تحديد الموقع من الجهاز. أدخل الإحداثيات يدويًا.":"انتهت مهلة تحديد الموقع. حاول مجددًا قرب المتجر.";
  help.textContent=message;button.disabled=false;button.textContent="⌖ حاول مجددًا";
 },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
});
})();
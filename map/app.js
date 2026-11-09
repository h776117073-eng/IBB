(function () {
  "use strict";
  var API = "https://ibb-market-api.aicreativestudio.workers.dev";
  var governorateBounds = [[13.7049486, 43.6516621], [14.4655897, 44.6814870]];
  var center = [14.08526915, 44.16657455];
  var map, layer, routeLayer, markers = [], currentKind = "", currentQuery = "", timer = null, requestId = 0;
  var routeOrigin = null, originMarker = null, pickingOrigin = false, routeBusy = false, lastRouteAt = 0;
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("status"), countEl = $("resultCount"), listEl = $("resultsList"), noticeEl = $("mapNotice");
  var routeStatusEl = $("routeStatus"), routeSummaryEl = $("routeSummary"), routeStepsEl = $("routeSteps");

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function kindLabel(kind) {
    return ({ BUSINESS: "منشأة تجارية", LANDMARK: "معلم", STREET: "شارع أو طريق", NEIGHBORHOOD: "حي أو حارة", PUBLIC_SERVICE: "خدمة عامة", OTHER: "موقع" })[kind] || "موقع";
  }
  function kindIcon(kind) {
    return ({ BUSINESS: "🏬", LANDMARK: "📍", STREET: "🛣️", NEIGHBORHOOD: "🏘️", PUBLIC_SERVICE: "🏥", OTHER: "📌" })[kind] || "📌";
  }
  function clearMarkers() {
    if (layer) layer.clearLayers();
    markers = [];
    listEl.replaceChildren();
  }
  function addEmpty(text) {
    var div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = text;
    listEl.appendChild(div);
  }
  function googleMapsUrl(place) {
    var point = encodeURIComponent(place.latitude + "," + place.longitude);
    return place.maps_url || ("https://www.google.com/maps/search/?api=1&query=" + point);
  }
  function directionsUrl(place) {
    return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(place.latitude + "," + place.longitude);
  }
  function setRouteOrigin(point, label) {
    routeOrigin = L.latLng(point.lat, point.lng);
    if (originMarker) map.removeLayer(originMarker);
    originMarker = L.circleMarker(routeOrigin, { radius: 8, color: "#075e56", weight: 3, fillColor: "#0d9488", fillOpacity: 1 }).addTo(map);
    originMarker.bindPopup(label || "نقطة الانطلاق");
    routeStatusEl.textContent = "تم تحديد نقطة الانطلاق. اختر موقعًا ثم اضغط «ارسم المسار إلى هنا».";
  }
  function clearRoute() {
    if (routeLayer) routeLayer.clearLayers();
    if (originMarker && map) map.removeLayer(originMarker);
    originMarker = null;
    routeOrigin = null;
    pickingOrigin = false;
    if (map) map.getContainer().style.cursor = "";
    $("pickOrigin").classList.remove("active");
    routeStatusEl.textContent = "حدد نقطة الانطلاق أو استخدم موقعك الحالي، ثم اختر موقعًا لرسم المسار.";
    routeSummaryEl.hidden = true;
    routeSummaryEl.textContent = "";
    routeStepsEl.hidden = true;
    routeStepsEl.replaceChildren();
  }
  function formatDistance(meters) {
    var value = Number(meters || 0);
    return value >= 1000 ? (value / 1000).toFixed(1) + " كم" : Math.round(value) + " م";
  }
  function formatDuration(seconds) {
    var minutes = Math.max(1, Math.round(Number(seconds || 0) / 60));
    if (minutes < 60) return minutes + " دقيقة";
    var hours = Math.floor(minutes / 60), rest = minutes % 60;
    return hours + " ساعة" + (rest ? " و" + rest + " دقيقة" : "");
  }
  function translateManeuver(step, mode) {
    var maneuver = step.maneuver || {};
    var type = maneuver.type || "";
    var modifier = maneuver.modifier || "";
    var direction = ({
      left: "يسارًا", right: "يمينًا", "slight left": "يسارًا قليلًا",
      "slight right": "يمينًا قليلًا", "sharp left": "يسارًا بشدة",
      "sharp right": "يمينًا بشدة", straight: "مباشرة", uturn: "للخلف"
    })[modifier] || "حسب الطريق";
    if (type === "depart") return mode === "pedestrian" ? "ابدأ المشي" : "ابدأ القيادة";
    if (type === "arrive") return "وصلت إلى الوجهة";
    if (type === "turn" || type === "end of road" || type === "fork") return "انعطف " + direction;
    if (type === "roundabout") return "اسلك الدوار";
    if (type === "merge") return "اندمج مع الطريق";
    if (type === "on ramp" || type === "off ramp") return "اسلك المنحدر";
    if (type === "uturn") return "استدر للخلف";
    return step.name ? "تابع على الطريق" : "تابع السير";
  }
  async function drawRouteToPlace(place) {
    if (!routeOrigin) {
      routeStatusEl.textContent = "حدد نقطة الانطلاق أولًا أو اضغط «موقعي الحالي».";
      return;
    }
    if (routeBusy) return;
    if (Date.now() - lastRouteAt < 1200) {
      routeStatusEl.textContent = "انتظر لحظة قبل طلب مسار آخر.";
      return;
    }
    lastRouteAt = Date.now();
    routeBusy = true;
    routeStatusEl.textContent = "جارٍ حساب مسار " + ( $("routeMode").value === "pedestrian" ? "المشي" : "القيادة" ) + "...";
    routeSummaryEl.hidden = true;
    routeStepsEl.hidden = true;
    routeStepsEl.replaceChildren();
    try {
      var mode = $("routeMode").value;
      var payload = {
        locations: [
          { lat: routeOrigin.lat, lon: routeOrigin.lng },
          { lat: Number(place.latitude), lon: Number(place.longitude) }
        ],
        costing: mode,
        units: "kilometers",
        format: "osrm",
        shape_format: "geojson",
        language: "en-US",
        id: "ibb-market-route"
      };
      var url = "https://valhalla1.openstreetmap.de/route?json=" + encodeURIComponent(JSON.stringify(payload));
      var response = await fetch(url, {
        headers: { Accept: "application/json", "X-Client-Id": "ibb-market.pages.dev" },
        cache: "no-store"
      });
      var data = await response.json();
      if (!response.ok || data.code !== "Ok" || !data.routes || !data.routes.length) throw new Error(data.code || "NO_ROUTE");
      var route = data.routes[0];
      if (!route.geometry || route.geometry.type !== "LineString") throw new Error("NO_ROUTE_GEOMETRY");
      routeLayer.clearLayers();
      L.geoJSON(route.geometry, { style: { color: "#087e73", weight: 6, opacity: 0.9 } }).addTo(routeLayer);
      L.circleMarker([place.latitude, place.longitude], { radius: 7, color: "#102a43", weight: 3, fillColor: "#fff", fillOpacity: 1 }).addTo(routeLayer);
      var routeBounds = routeLayer.getBounds();
      if (routeBounds.isValid()) map.fitBounds(routeBounds, { padding: [36, 36] });
      var modeLabel = mode === "pedestrian" ? "مشياً" : "بالسيارة";
      routeSummaryEl.textContent = place.name + " · " + formatDistance(route.distance) + " · " + formatDuration(route.duration) + " · " + modeLabel;
      routeSummaryEl.hidden = false;
      var steps = route.legs && route.legs[0] ? (route.legs[0].steps || []) : [];
      steps.forEach(function (step) {
        var item = document.createElement("li");
        var text = translateManeuver(step, mode);
        if (step.name) text += " — " + step.name;
        if (step.distance) text += " · " + formatDistance(step.distance);
        item.textContent = text;
        routeStepsEl.appendChild(item);
      });
      routeStepsEl.hidden = !steps.length;
      routeStatusEl.textContent = "تم رسم المسار. مصدر التوجيه: Valhalla / OpenStreetMap.";
    } catch (error) {
      routeLayer.clearLayers();
      routeStatusEl.textContent = "تعذر حساب المسار من خدمة التوجيه التجريبية. يمكنك فتح الوجهة في Google Maps.";
    } finally {
      routeBusy = false;
    }
  }
  function popupNode(place) {
    var box = document.createElement("div");
    var title = document.createElement("div");
    title.className = "popup-title";
    title.textContent = place.name || "موقع";
    var meta = document.createElement("div");
    meta.className = "popup-meta";
    meta.textContent = kindLabel(place.kind) + (place.category ? " · " + place.category : "") + (place.address ? " · " + place.address : "");
    var maps = document.createElement("a");
    maps.className = "popup-link";
    maps.href = googleMapsUrl(place);
    maps.target = "_blank";
    maps.rel = "noopener noreferrer";
    maps.textContent = "فتح الموقع في Google Maps";
    var routeButton = document.createElement("button");
    routeButton.type = "button";
    routeButton.className = "popup-route-button";
    routeButton.textContent = "ارسم المسار إلى هنا";
    routeButton.addEventListener("click", function () { drawRouteToPlace(place); });
    var details = document.createElement("a");
    details.className = "popup-link";
    details.href = "../market/place/?id=" + encodeURIComponent(place.id);
    details.textContent = "عرض صفحة الموقع والتفاصيل";
    box.append(title, meta, routeButton, maps, details);
    return box;
  }
  function markerIcon(place) {
    var className = "map-pin";
    if (place.kind === "LANDMARK") className += " landmark";
    else if (place.kind === "STREET") className += " street";
    else if (place.kind === "NEIGHBORHOOD") className += " neighborhood";
    else if (place.kind === "PUBLIC_SERVICE") className += " public";
    if (place.location_precision === "APPROXIMATE") className += " approximate";
    return L.divIcon({ className: "", html: '<div class="' + className + '"><span>' + kindIcon(place.kind) + "</span></div>", iconSize: [30, 36], iconAnchor: [15, 34] });
  }
  function addPlace(place) {
    var marker;
    if (place.geometry && place.geometry.type && place.geometry.coordinates) {
      var feature = { type: "Feature", geometry: place.geometry, properties: { name: place.name } };
      marker = L.geoJSON(feature, { style: { color: place.kind === "STREET" ? "#64748b" : "#087e73", weight: 4, opacity: 0.8, fillOpacity: 0.12 } });
    } else {
      marker = L.marker([place.latitude, place.longitude], { icon: markerIcon(place) });
    }
    marker.bindPopup(popupNode(place));
    marker.addTo(layer);
    markers.push(marker);
  }
  function addCluster(cluster) {
    var icon = L.divIcon({ className: "", html: '<div class="map-cluster">' + esc(cluster.count) + "</div>", iconSize: [42, 42], iconAnchor: [21, 21] });
    var marker = L.marker([cluster.latitude, cluster.longitude], { icon: icon });
    marker.on("click", function () { map.setView([cluster.latitude, cluster.longitude], Math.min(19, map.getZoom() + 2)); });
    marker.bindTooltip(cluster.count + " موقع");
    marker.addTo(layer);
    markers.push(marker);
  }
  function renderList(items, clustered) {
    listEl.replaceChildren();
    if (!items.length) {
      addEmpty("لا توجد مواقع من مصدر خرائط Google ضمن هذا النطاق. جرّب تغيير البحث أو توسيع الخريطة.");
      return;
    }
    if (clustered) {
      addEmpty("تظهر مجموعات المواقع عند هذا المستوى. قرّب الخريطة لعرض أسماء المواقع وتفاصيلها.");
      return;
    }
    items.slice(0, 120).forEach(function (place) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "result-card";
      var icon = document.createElement("span");
      icon.className = "result-icon";
      icon.textContent = kindIcon(place.kind);
      var copy = document.createElement("span");
      copy.className = "result-copy";
      var name = document.createElement("strong");
      name.textContent = place.name || "موقع";
      var meta = document.createElement("small");
      meta.textContent = kindLabel(place.kind) + (place.category ? " · " + place.category : "") + (place.neighborhood ? " · " + place.neighborhood : "");
      copy.append(name, meta);
      var tag = document.createElement("span");
      tag.className = "result-tag";
      tag.textContent = place.location_precision === "APPROXIMATE" ? "إحداثيات تقريبية" : "إحداثيات Google Maps";
      button.append(icon, copy, tag);
      button.addEventListener("click", function () {
        map.setView([place.latitude, place.longitude], Math.max(16, map.getZoom()));
        var target = markers.find(function (m) { return m.getLatLng && Math.abs(m.getLatLng().lat - place.latitude) < 0.00001 && Math.abs(m.getLatLng().lng - place.longitude) < 0.00001; });
        if (target) target.openPopup();
      });
      listEl.appendChild(button);
    });
  }
  async function loadPlaces() {
    if (!map || !navigator.onLine) {
      statusEl.textContent = "لا يوجد اتصال بالإنترنت";
      return;
    }
    var bounds = map.getBounds();
    var west = bounds.getWest(), south = bounds.getSouth(), east = bounds.getEast(), north = bounds.getNorth();
    if (east - west > 2.0 || north - south > 2.0) {
      statusEl.textContent = "قرّب الخريطة داخل محافظة إب لتحميل المواقع";
      noticeEl.textContent = "يُحمّل الدليل ضمن نطاق محافظة إب لتقليل البيانات وتحسين السرعة.";
      noticeEl.hidden = false;
      return;
    }
    noticeEl.hidden = true;
    var id = ++requestId;
    var params = new URLSearchParams({
      bbox: [west, south, east, north].join(","),
      zoom: String(map.getZoom()),
      limit: "500"
    });
    if (currentKind) params.set("kind", currentKind);
    if (currentQuery) params.set("q", currentQuery);
    statusEl.textContent = "جارٍ تحميل المواقع...";
    try {
      var response = await fetch(API + "/api/v1/map/places?" + params.toString(), { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var data = await response.json();
      if (id !== requestId) return;
      if (!data.ok) throw new Error(data.error || "API_ERROR");
      clearMarkers();
      var items = Array.isArray(data.items) ? data.items : [];
      items.forEach(function (item) { if (item.cluster) addCluster(item); else addPlace(item); });
      renderList(items, !!data.clustered);
      countEl.textContent = data.clustered ? items.reduce(function (n, x) { return n + Number(x.count || 0); }, 0).toLocaleString("ar") : items.length.toLocaleString("ar");
      statusEl.textContent = data.clustered ? "مجموعات مواقع ضمن النطاق" : "مواقع من خرائط Google ضمن النطاق";
      if (!items.length) {
        noticeEl.textContent = "واجهة الخريطة جاهزة، لكن لا توجد سجلات منشورة في قاعدة بيانات الخريطة حتى الآن.";
        noticeEl.hidden = false;
      }
    } catch (error) {
      if (id !== requestId) return;
      statusEl.textContent = "تعذر تحميل بيانات المواقع";
      clearMarkers();
      addEmpty("تعذر الاتصال بخدمة الخريطة. تحقق من الاتصال ثم أعد المحاولة.");
    }
  }
  function scheduleLoad() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(loadPlaces, 280);
  }
  function init() {
    if (!window.L) {
      statusEl.textContent = "تعذر تحميل مكتبة الخريطة";
      addEmpty("تعذر تحميل الخريطة. أعد تحميل الصفحة عند توفر اتصال أفضل.");
      return;
    }
    map = L.map("map", {
      center: center, zoom: 9, minZoom: 8, maxZoom: 19, zoomControl: true, preferCanvas: true
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.fitBounds(governorateBounds, { padding: [24, 24] });
    map.on("moveend", scheduleLoad);
    map.on("click", function (event) {
      if (!pickingOrigin) return;
      setRouteOrigin(event.latlng, "نقطة الانطلاق المحددة");
      pickingOrigin = false;
      $("pickOrigin").classList.remove("active");
      map.getContainer().style.cursor = "";
    });
    $("fitGovernorate").addEventListener("click", function () {
      map.fitBounds(governorateBounds, { padding: [24, 24] });
    });
    $("pickOrigin").addEventListener("click", function () {
      pickingOrigin = !pickingOrigin;
      this.classList.toggle("active", pickingOrigin);
      map.getContainer().style.cursor = pickingOrigin ? "crosshair" : "";
      routeStatusEl.textContent = pickingOrigin ? "انقر على الخريطة لتحديد نقطة الانطلاق." : "تم إلغاء تحديد نقطة الانطلاق.";
    });
    $("clearRoute").addEventListener("click", clearRoute);
    $("searchForm").addEventListener("submit", function (event) {
      event.preventDefault();
      currentQuery = $("placeSearch").value.trim();
      if (currentQuery) map.setZoom(Math.max(15, map.getZoom()));
      loadPlaces();
    });
    $("clearSearch").addEventListener("click", function () {
      $("placeSearch").value = "";
      currentQuery = "";
      loadPlaces();
    });
    document.querySelectorAll("[data-kind]").forEach(function (button) {
      button.addEventListener("click", function () {
        currentKind = button.getAttribute("data-kind") || "";
        document.querySelectorAll("[data-kind]").forEach(function (x) { x.classList.toggle("active", x === button); });
        loadPlaces();
      });
    });
    $("locateMe").addEventListener("click", function () {
      if (!navigator.geolocation) { statusEl.textContent = "تحديد الموقع غير مدعوم في هذا الجهاز"; return; }
      statusEl.textContent = "جارٍ تحديد موقعك...";
      navigator.geolocation.getCurrentPosition(function (position) {
        var point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setRouteOrigin(point, "موقعي الحالي");
      }, function () {
        statusEl.textContent = "لم نتمكن من تحديد موقعك. تحقق من إذن الموقع.";
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
    window.addEventListener("online", scheduleLoad);
    window.addEventListener("offline", function () { statusEl.textContent = "أنت غير متصل بالإنترنت"; });
    setTimeout(function () { map.invalidateSize(); loadPlaces(); }, 120);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

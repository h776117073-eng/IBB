(function () {
  "use strict";
  var API = "https://ibb-market-api.aicreativestudio.workers.dev";
  var center = [13.9667, 44.1833];
  var map, layer, markers = [], currentKind = "", currentQuery = "", timer = null, requestId = 0;
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("status"), countEl = $("resultCount"), listEl = $("resultsList"), noticeEl = $("mapNotice");

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
    box.append(title, meta, maps);
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
      addEmpty("لا توجد مواقع موثقة ضمن هذا النطاق. جرّب تغيير البحث أو توسيع الخريطة.");
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
      tag.textContent = place.location_precision === "APPROXIMATE" ? "تقريبي" : "موثق";
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
    if (east - west > 1.2 || north - south > 1.2) {
      statusEl.textContent = "قرّب الخريطة إلى مدينة إب لتحميل المواقع";
      noticeEl.textContent = "يُحمّل الدليل ضمن نطاق مدينة إب لتقليل البيانات وتحسين السرعة.";
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
      statusEl.textContent = data.clustered ? "مجموعات مواقع ضمن النطاق" : "مواقع موثقة ضمن النطاق";
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
    map = L.map("map", { center: center, zoom: 13, minZoom: 10, maxZoom: 19, zoomControl: true, preferCanvas: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.on("moveend", scheduleLoad);
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
        map.setView([position.coords.latitude, position.coords.longitude], 16);
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

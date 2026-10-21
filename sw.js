'use strict';
const CACHE_NAME = 'ibb-market-static-v4';
const CORE_FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg', './data/index.json'];
self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    return cache.addAll(CORE_FILES).catch(function(){ return undefined; });
  }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(key){ return key.indexOf('ibb-market-static-')===0 && key!==CACHE_NAME; }).map(function(key){ return caches.delete(key); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(function(cached) {
    const network = fetch(request).then(function(response) {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(request, copy).catch(function(){}); });
      }
      return response;
    });
    return cached || network.catch(function(){ return new Response('غير متصل — لم تتوفر هذه البيانات في ذاكرة الجهاز.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}}); });
  }));
});
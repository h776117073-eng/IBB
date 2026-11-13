/**
 * Ibb GeoPlatform Commercial SDK v3.0 (ibb-map-sdk.js)
 * واجهة برمجة التطبيقات التجارية لدمج خريطتي لمحافظة إب مع المتاجر وتطبيقات التوصيل والأنظمة المحاسبية
 */
(function (global) {
  'use strict';

  const IbbMapSDK = {
    version: '3.0.0-enterprise',
    provider: 'خريطتي لمحافظة إب — المنصة الجيومكانية المستقلة',

    // البحث الجغرافي والتجاري المباشر
    async searchPlaces(query, options = {}) {
      if (global.IbbPlatformApp && global.IbbPlatformApp.search) {
        return global.IbbPlatformApp.search(query, options);
      }
      throw new Error('IbbPlatformApp is not initialized yet.');
    },

    // حساب المسار وتكلفة التوصيل التقديرية (بالريال اليمني)
    async calculateDeliveryRoute(origin, destination, mode = 'driving') {
      if (global.IbbPlatformApp && global.IbbPlatformApp.route) {
        const r = await global.IbbPlatformApp.route(origin, destination, mode);
        if (r) {
          const km = r.distanceMeters / 1000;
          r.estimatedDeliveryFeeYER = Math.max(500, Math.round((400 + km * 250) / 50) * 50);
        }
        return r;
      }
      throw new Error('Routing engine not initialized.');
    },

    // تحويل الإحداثيات إلى عنوان ذكي ورمز Plus Code
    reverseGeocode(lat, lng) {
      if (global.IbbPlatformApp && global.IbbPlatformApp.reverseGeocode) {
        return global.IbbPlatformApp.reverseGeocode(lat, lng);
      }
      return null;
    },

    // تحريك الكاميرا وإبراز منشأة تجارية
    flyToPlace(lat, lng, zoom = 18) {
      if (global.IbbPlatformApp && global.IbbPlatformApp.flyTo) {
        global.IbbPlatformApp.flyTo(lat, lng, zoom);
      }
    }
  };

  // دعم التخاطب عبر النوافذ المضمنة (iframe postMessage API) للتطبيقات الخارجية
  global.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.channel !== 'IBB_MAP_SDK_V3') return;
    try {
      let response = null;
      if (data.action === 'SEARCH') {
        response = await IbbMapSDK.searchPlaces(data.query, data.options || {});
      } else if (data.action === 'ROUTE') {
        response = await IbbMapSDK.calculateDeliveryRoute(data.origin, data.destination, data.mode);
      } else if (data.action === 'REVERSE_GEOCODE') {
        response = IbbMapSDK.reverseGeocode(data.lat, data.lng);
      } else if (data.action === 'FLY_TO') {
        IbbMapSDK.flyToPlace(data.lat, data.lng, data.zoom);
        response = { ok: true };
      }
      if (event.source) {
        event.source.postMessage({ channel: 'IBB_MAP_SDK_V3_RESPONSE', reqId: data.reqId, ok: true, data: response }, '*');
      }
    } catch (err) {
      if (event.source) {
        event.source.postMessage({ channel: 'IBB_MAP_SDK_V3_RESPONSE', reqId: data.reqId, ok: false, error: err.message }, '*');
      }
    }
  });

  global.IbbMapSDK = IbbMapSDK;
})(typeof window !== 'undefined' ? window : this);

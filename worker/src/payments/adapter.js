export const PAYMENT_REQUIRED_CONFIGURATION = Object.freeze([
  "PAYMENT_PROVIDER_CODE",
  "PAYMENT_API_URL",
  "PAYMENT_API_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_RETURN_URL"
]);

export function paymentReadiness(env = {}) {
  const missing = PAYMENT_REQUIRED_CONFIGURATION.filter((key) => !String(env[key] || "").trim());
  const providerConfigured = missing.length === 0;
  return {
    currency: "YER",
    provider_configured: providerConfigured,
    checkout_enabled: false,
    status: providerConfigured ? "ADAPTER_TESTS_REQUIRED" : "READY_FOR_LOCAL_PROVIDER",
    provider_code: providerConfigured ? String(env.PAYMENT_PROVIDER_CODE) : null,
    missing_configuration: missing,
    required_adapter_methods: ["createIntent", "verifyWebhook", "getStatus", "refund"],
    note: "لا تُفعّل المدفوعات حتى إضافة محول المزود المحلي واجتياز اختبارات التوقيع والتكرار والاسترداد والتسوية."
  };
}

export function assertPaymentAdapter(adapter) {
  const methods = ["createIntent", "verifyWebhook", "getStatus", "refund"];
  const missing = methods.filter((name) => !adapter || typeof adapter[name] !== "function");
  if (missing.length) throw new TypeError("Payment adapter contract incomplete: " + missing.join(", "));
  return adapter;
}

export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}

export async function verifyHmacSha256(rawBody, signature, secret) {
  if (!secret || typeof rawBody !== "string" || typeof signature !== "string") return false;
  const supplied = signature.replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(supplied)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, supplied);
}

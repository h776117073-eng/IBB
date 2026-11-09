import test from "node:test";
import assert from "node:assert/strict";
import { paymentReadiness, assertPaymentAdapter, verifyHmacSha256 } from "../src/payments/adapter.js";

test("local payments remain disabled until provider configuration and adapter tests", () => {
  const state = paymentReadiness({});
  assert.equal(state.currency, "YER");
  assert.equal(state.checkout_enabled, false);
  assert.equal(state.provider_configured, false);
  assert.ok(state.missing_configuration.includes("PAYMENT_WEBHOOK_SECRET"));
});

test("payment adapter contract requires all four provider operations", () => {
  assert.throws(() => assertPaymentAdapter({ createIntent() {} }), /verifyWebhook/);
  const adapter = {
    createIntent() {}, verifyWebhook() {}, getStatus() {}, refund() {}
  };
  assert.equal(assertPaymentAdapter(adapter), adapter);
});

test("webhook HMAC verification accepts a valid signature and rejects a wrong one", async () => {
  const body = "{\"event\":\"paid\"}";
  const secret = "local-test-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const signature = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyHmacSha256(body, "sha256=" + signature, secret), true);
  assert.equal(await verifyHmacSha256(body, "sha256=" + "0".repeat(64), secret), false);
});

# IBB Market — non-map delivery track

**Date:** 2026-11-15  
**Scope:** consumer commerce, merchant operations, administration, orders, delivery, support, and finance. Map rendering, geospatial ingestion, Overture/PMTiles, and map publication are explicitly excluded from this track.

## Baseline verified

- The active production API architecture in this repository is Cloudflare Worker + D1 (`ibb-market-shared`) + R2 product media.
- The current web customer experience reads approved stores and active products. The cart is local preview only and does not create an order.
- The merchant portal submits store/product proposals for review; it is not an authenticated merchant account or inventory console.
- The admin submission page can approve/reject proposals using an ephemeral shared admin key. Approval of a directory record does not verify ownership.
- Payment readiness is a status contract only. Checkout remains disabled until a local provider adapter, signature/replay/refund/reconciliation tests, and legal/operational approval exist.
- The connected Supabase project inspected during this work is a separate geospatial project and is not the commerce database described by `docs/SUPABASE_INTEGRATION_PLAN.md`; it must not be repurposed by name similarity.

## Delivered in this change

1. Admin-only summary for stores, products, and pending/rejected submissions.
2. Admin-only store/product listing with parameterized search and status filters.
3. Store suspension/reactivation and product suspension/reactivation. A product cannot be reactivated while its parent store is suspended.
4. Append-only `admin_audit_log` records for each actual status transition. The audit stores a SHA-256 fingerprint of the shared admin key, never the key itself.
5. A separate Arabic RTL operations page with ephemeral key handling, summary metrics, entity moderation, audit history, and payment-readiness display.
6. Automated tests for authorization, status validation, parameterized filters, conditional update/audit behavior, and parent-store constraints.

## Explicitly not delivered or enabled

| Domain | Current state | Required dependency / release gate |
|---|---|---|
| Customer identity / OTP | Not implemented | Confirm +967 SMS/WhatsApp OTP provider, abuse controls, account recovery, token rotation, and privacy requirements.
| Merchant accounts / staff roles | Not implemented | Verified owner onboarding, staff/terminal roles, server-side authorization, and identity evidence policy.
| Orders / checkout / inventory reservation | Not implemented; cart remains preview-only | Authoritative order state machine, idempotency, stock reservation/race tests, pricing snapshots, cancellation/refund rules, and authenticated actors.
| Courier dispatch / proof of delivery | Not implemented | Confirm local courier coverage, worker terms/safety, OTP fallback, service areas, and support escalation.
| Disputes / refunds | Not implemented | Reviewed evidence policy, retention/deletion rules, impartial review, appeal path, and permitted refund rail.
| Ledger / escrow-like holds / payouts | Not implemented; no funds movement | Local legal/regulatory review and a licensed, contracted provider with reconciled sandbox transactions. Do not infer that Saudi SAR/Mada/IBAN/ZATCA assumptions apply in Yemen.
| Production deployment / migration | Not performed in this change | Cloudflare API connection currently returns authentication errors. Apply migration only after a verified staging backup and explicit deployment authorization.

## Data and security invariants

- `stores.status` (publication/moderation) is separate from `stores.owner_verified` (ownership).
- Public store/product queries continue to exclude suspended records.
- All new operational endpoints require `ADMIN_API_KEY`; browser code never persists it.
- Search values are bound SQL parameters; no dynamic user-controlled SQL identifiers are accepted.
- Status changes are conditional on the previous state and append an audit record in the same D1 batch.
- Payment readiness is informational; this change does not create payment intents, enable checkout, or move money.
- No raw directory data, verified-directory imports, map tables, or geospatial services are modified.

## Next non-map implementation sequence

1. Establish the correct commerce identity/database target; do not use the geospatial Supabase project as a substitute.
2. Implement phone OTP and role-bound sessions with provider-backed integration tests.
3. Implement merchant workspace and product/inventory lifecycle behind verified merchant roles.
4. Implement customer order creation and state transitions only after identity, stock reservation, and cancellation semantics pass tests.
5. Implement courier dispatch and delivery proof after local coverage and safety procedures are confirmed.
6. Implement support/disputes, double-entry ledger, refunds, settlements, and payouts only after local legal/provider gates.
7. Run end-to-end, accessibility, security, backup/restore, and production rollback checks before any release.

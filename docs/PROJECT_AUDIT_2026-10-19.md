# IBB Market — Five-Reviewer Project Audit
**Date:** 2026-10-19  
**Repository:** https://github.com/h776117073-eng/IBB  
**Scope:** product concept, mobile UX/design from source code, data integrity, architecture, privacy/security, and release quality.  
**Evidence boundary:** repository files were inspected. This is a code-and-document review; a current visual screenshot was not inspected and no five autonomous subagents were launched in this chat. These are five structured review passes, not claims of five separate AI instances.

## Executive verdict
**Keep the core idea; do not present the current build as a complete marketplace.** The defensible first release is a mobile-first Arabic directory for discovering and gradually verifying Ibb listings. The current implementation is a static prototype: it imports 11,060 names, not verified stores or complete business profiles. Store submissions, locations, follows, products, and likes are local to one device. There is no shared account system, shared listing database, verified ownership, real public product catalog, checkout, or actual AI assistant.

The central gap is between the implied promise of a citywide marketplace and the actual capabilities. Existing warnings about unverified names and local-only behavior are valuable and should remain consistent.

## Reviewer 1 — Product advocate / supporter
**Keep:** Arabic-first local discovery, the existing names seed dataset, RTL responsive layout, search, map, and PWA foundation.

**Recommendation:** Position the first release as “ابحث عن اسم منشأة في إب، وساعد في استكمال بياناتها والتحقق منها.” Prioritize trusted listings and community correction before sales, ads, inventory, or delivery. Measure success by verified coordinates, valid contact data, freshness, and duplicate resolution—not raw name count.

**Evidence:** README, data/index.json, and top-level UI copy in index.html.

## Reviewer 2 — UX and design critic
**Strengths:** Arabic RTL; responsive breakpoints; mobile bottom navigation; visible focus styles; reduced-motion support; loading and empty states; explicit notice that imported data is names-only and unverified; lazy loading of Leaflet.

**Findings**
1. **Mitigated — Inactive image-search control:** in commit e02279e, the button is disabled and labeled “بحث بالصورة — قريبًا” so it cannot masquerade as a working feature. Re-enable only after end-to-end image matching is implemented and tested.
2. **Mitigated — Local-only submission expectation:** in commit e02279e, the CTA was shortened to “أضف محليًا” and given a tooltip explaining that the entry stays on this device. Keep the local-only warning in the submission flow.
3. **P2 — Map mental model:** 11,060 names beside a city map can imply they are geolocated. Keep a persistent distinction between imported names and locally placed pins.
4. **Mitigated — Search scope ambiguity:** in commit e02279e, the main search prompt now says it searches establishment names. The experimental assistant remains explicitly local and can match locally entered products.
5. **P2 — Mobile density:** the header, empty promotion slot, followed section, directory, product catalog, floating assistant, and fixed navigation compete for space. Consider collapsing empty sections.

**Visual limitation:** code-only review; no pixel-level defect is claimed without a current screenshot.

## Reviewer 3 — Architecture and data auditor
1. **P1 — No shared persistence:** index.html uses localStorage for stores, products, follows, likes, and location overrides. Another user/device cannot see those changes.
2. **P1 — Source is not a verified business database:** data/index.json records importedFields=[name], source column “اسم المنشأة أو المعلم”, 11,060 records, chunk size 500, and 23 chunks. A name does not prove an active business, nor rule out landmarks, duplicates, branches, or stale records.
3. **P1 — Worker/API integration gap:** project notes describe Cloudflare Worker and R2 endpoints, but the product form in index.html saves metadata locally and accepts a public image URL. It does not call the upload API or publish metadata through the shared products API. Do not describe R2 as an active upload pipeline until wired and tested.
4. **P2 — Monolithic front end:** UI, state, storage, search, map, and dialogs largely live in one index.html. Add tests first, then split responsibilities incrementally rather than performing a large rewrite.
5. **P2 — Browser storage quota:** caching all 11,060 names in localStorage may exceed quotas on some devices; verify saveSaved failure behavior. Consider IndexedDB or bounded caching.
6. **P2 — External map dependencies:** Leaflet and map tiles need third-party network access. The page has fallbacks, but map use is not fully offline.

## Reviewer 4 — Security and privacy auditor
1. **P1 — Public trust workflow absent:** no account/ownership verification or moderation workflow is present. Before public writes, add server-side validation, authorization, rate limits, audit logs, and moderation.
2. **P1 — Local storage is not backup:** local entries can disappear when browser/site data is cleared and are not shared across devices. State this beside each save action.
3. **P1 — Public image URLs:** validate protocols and safe rendering; reject non-HTTP(S) schemes and test redirects and abusive hosts before adding previews. Do not inject untrusted strings as HTML.
4. **P1 — Upload-key handling:** previous deployment notes said the Worker upload key was a plain-text binding. Verify its current binding type and rotate to a secret if it remains plaintext. Never place the key in frontend code.
5. **P2 — Data minimization:** do not collect identity documents until private encrypted storage, restricted access, deletion policy, and retention rules exist.
6. **P2 — XSS review:** escapeHTML is used in several dynamic templates, which is positive, but every template path, source name, product field, image URL, and map popup needs systematic testing.

## Reviewer 5 — Skeptical opponent / QA
**Claims that are not currently supported**
- “11,060 businesses”: not supported; the source column is “اسم المنشأة أو المعلم”, and only names were imported.
- “Citywide interactive map”: not yet supported; imported names have no coordinates, and map pins are manually entered locally.
- “Marketplace”: not yet supported; products are local, with no shared inventory, checkout, delivery, or seller accounts.
- “AI assistant”: not supported; the current assistant performs local text matching.
- “Image search”: not implemented.
- “Cloud upload”: not wired from the product form based on inspected code.
- “Reliable offline PWA”: not established; manifest and service worker exist, but offline behavior, storage limits, and update handling require device tests.
- “Duplicate-free”: not established by index metadata alone; add normalization and human review without automatically merging branches.

**P1 release risk:** the user reported DNS_PROBE_FINISHED_NXDOMAIN for the Worker hostname. Cloudflare settings were confirmed enabled and remote browser rendering previously returned HTTP 200, but this does not prove DNS resolution from the user’s ISP or phone. Keep status as “remote checks passed; affected-device DNS unresolved” until a fresh test from the device/network succeeds.

## Ranked improvement plan
| Priority | Change | Why | Acceptance test |
|---|---|---|---|
| P1 | Align all remaining UI wording with prototype reality | Avoid implying verified/shared listings | Review every create/save/map/catalog flow on device; core CTA and search wording were corrected in e02279e |
| P1 | Test DNS and canonical deployment from multiple networks | Users must resolve the hostname | Resolve and open from mobile data and Wi-Fi; record time and results |
| P1 | Verify Worker upload key is secret | Protect upload endpoint | Confirm binding type, rotate if exposed, test authorized/unauthorized upload without printing key |
| P1 | Define shared persistence and auth before public submissions | Prevent data-loss and false shared-state expectations | Two devices see the same approved listing after authenticated submission |
| Done | Disable and relabel inactive image-search affordance | Reduce dead ends | Button disabled and labeled “قريبًا” in e02279e; keep disabled until end-to-end feature exists |
| P2 | Add data-quality pipeline | Names alone are not a verified directory | Report normalized names, suspected duplicates, ambiguous branches, and reviewed records |
| P2 | Move large cache to IndexedDB or bounded cache | Reduce quota/performance failures | Load all chunks on low-storage Android; refresh/offline tests pass |
| P2 | Add automated UI/data checks | Catch missing chunks, stale cache, broken paths | CI validates chunk count, total records, schema, paths, and smoke flows |
| P3 | Polish from actual mobile screenshots | Improve hierarchy after trust gaps close | Review 360px and 390px screenshots with keyboard, empty states, and map open |

## Release gate
Do not announce a fully operational marketplace until phone DNS works from at least two networks; all 23 chunks load and counts match; duplicate/data-quality metrics are measured; shared backend, authentication, and moderation exist; upload authorization is reviewed; and critical mobile flows have repeatable tests.

## Decision
**Continue, but narrow the claim.** Treat the current release as an Arabic directory prototype for business and landmark names in Ibb. Deliver verified locations and shared persistence before monetization or transaction features.

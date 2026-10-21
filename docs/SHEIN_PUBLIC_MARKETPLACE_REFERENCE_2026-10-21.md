# SHEIN Public Marketplace Reference Analysis — 2026-10-21

## 1. Executive summary

This report documents the public consumer-facing SHEIN storefront, public seller onboarding materials, official developer documentation, and the current IBB Market repository as an evidence-led reference study. The purpose is to extract reusable e-commerce patterns for an independent, Arabic-first local marketplace serving Ibb, Yemen—not to clone SHEIN or claim access to its private internals.

**Current decision:** SHEIN is a useful reference for product discovery, dense catalog presentation, product variant modelling, image-led search, merchant onboarding, listing review, inventory/order workflows, and seller operational tooling. IBB is currently a static directory prototype, not yet an operational multi-seller commerce platform. The most important next step is not to imitate every screen; it is to build shared, trustworthy store records, claim/verification, and a shared product catalogue before allowing transactions.

### Evidence boundary

- **Observed public pages:** the US SHEIN homepage and sampled product-detail pages, as rendered/indexed in this research session.
- **Official documentation:** SHEIN Help Center image-search guidance, regional seller portals, the public Seller Marketplace onboarding guide, and the SHEIN Developer Platform.
- **IBB evidence:** repository README, ROADMAP, current project audit dated 2026-10-19, index.html, data index/chunks inventory, existing validation script, and the existing five-reviewer skill.
- **Not observed:** private source code, private backend services, internal ranking models, personal accounts, authenticated checkout, seller applications, private APIs, fraud systems, or transactions. No attempt was made to bypass controls or discover secrets.
- **Confidence:** high for visible UI fields and statements in official documentation; medium for architecture recommendations derived from multiple visible signals; low for any unverified description of SHEIN's proprietary ranking or recommendation internals.

## 2. What was directly observed on SHEIN

### 2.1 Homepage and global discovery shell

The public US homepage renders a broad category/navigation surface with categories including Women, Shoes, Curve, Jewelry & Accessories, Kids, Home & Living, Men, Beauty & Health, Baby & Maternity, Sports & Outdoor, and additional categories such as Tops, Beachwear, Dresses, Underwear & Sleepwear, Bags & Luggage, Toys & Games, Electronics, Home Appliances, and others.

The sample also exposes promotional/discovery modules and product cards with product imagery, descriptive names, prices, and promotional labels such as flash sale, percent-off and trend/collection labels. There is evidence of a discovery-first presentation in which editorial/promotional content and catalog inventory share the initial browsing experience.

**IBB translation:** keep a simple local home screen, but make the content sections conditional on real data. Do not show empty promotion blocks or imply that followed stores or products exist in a shared service when they do not. In a mature IBB implementation, local paid placements should remain explicitly labeled and must match the search/context; unverified store names should never be presented as verified recommendations.

### 2.2 Product detail pages (sampled examples)

Public product pages can expose, depending on item and region:
- product name and a product/SKU identifier;
- visible price and potentially a displayed installment option;
- choice of size or other variant values;
- size guide for apparel where relevant;
- sold-out/availability state;
- product description and structured attributes (for example material, composition, color, style, occasion, type, care instructions or similar item-specific properties);
- product imagery and related visual content;
- customer review/rating details when available;
- brand/store information where applicable.

Two different publicly indexed product pages were sampled. One exposed size choices, a size guide, and an “About Store” section; another exposed a product SKU, options, price/availability state, structured product details, and a customer review. These are examples, not proof that every field is present for every listing or every regional storefront.

**Key design principle:** the detail page should resolve the selected variant, stock status, price, seller/source and product attributes together. A price without a freshness timestamp or variant context can mislead a shopper. When stock is unknown, show “غير معروف/آخر تحديث غير متاح” rather than asserting in-stock.

### 2.3 Search by image

SHEIN's official Help Center explains an in-app Visual Search entry opened through the camera icon in the search bar. It supports pointing the camera at an item, taking a product photo, or choosing an image from the phone's photo library. The help article says results can fail when the image is blurred, lighting is inadequate, or the object is unclear; an item may also be unavailable or no longer listed. The same article says this capability is available in the app and not supported on PC at the time described by that article.

**What this proves:** an image-search experience is publicly documented, including camera/gallery entry and basic failure cases.

**What this does not prove:** the private image embedding model, search index, similarity metric, training set, candidate generation, ranking formula, thresholds, or fallback logic. None of those are disclosed by the UI or the help article.

**IBB translation:** do not reactivate the currently disabled image-search button until an end-to-end pipeline works. A practical first version can compute embeddings for consented product images in IBB's own catalog, retrieve nearest candidates, then rerank using product category, color, text, stock freshness and distance. Return “لم نجد تطابقًا موثوقًا” when confidence is low; do not pretend to search the entire internet.

### 2.4 Seller onboarding and verification

The US SHEIN Marketplace seller materials describe a staged process:
1. apply with business information;
2. have the application and required documents reviewed;
3. work with an assigned account manager/onboarding process;
4. list products through available paths such as API integration, solution providers, or the Seller Hub;
5. fulfill orders using permitted fulfillment choices;
6. receive settlement according to the seller program's stated schedule.

The US onboarding page lists market-specific qualifications and documents, including US-based operations and shipping, a minimum annual revenue threshold, business formation documents, tax documentation, trademark documentation, a logo, and identity documents for a company representative. Those rules apply to the referenced US program and must **not** be generalized to the Middle East, Yemen or every SHEIN seller program.

The Middle East merchant portal presents a similar high-level path: apply, verification, list products, ship orders and receive payments. The public landing page reviewed here does not establish that every Yemeni business is eligible or specify a complete Yemen-specific legal/verification checklist.

SHEIN's public compliance page describes seller credential checks and review of required product information/documents, with ongoing governance after products are listed.

**IBB translation:** a seller application is not a single “create store” form. Model application state, ownership claim, document review, product review, selling permission and suspension separately. Offer a clear status and reason for any pending/rejected state. Never collect identity documents until private encrypted storage, access restrictions, retention/deletion policy and an administrator workflow are in place.

### 2.5 Product publishing and official seller APIs

The public SHEIN Developer Platform exposes a broad seller-side workflow surface, including documented functions for:
- product publish/edit and partial edits;
- checking whether a store can publish or a product can be edited;
- querying product review/audit state;
- searching/listing approved products and obtaining product detail;
- retrieving category trees and category-specific attribute templates;
- image/text-assisted category recommendation;
- image upload/transformation;
- product listing quotas and duplicate seller-SKU checks;
- product certificate requirements and certificate uploads/pools;
- querying and updating seller inventory;
- obtaining order lists/details, shipping information and related shipment operations.

This matters because a mature catalogue is not just a title, photo and price. It needs schema validation, variant identity, listing review, inventory state, seller permissions, error handling, and post-publication operations.

Public API documentation also distinguishes product identifiers commonly represented as SPU, SKC and SKU, and warns that a product submission can be pending or rejected before it appears in the approved-product listing query. A product creation response may return identifiers before a product has cleared review. These are seller integration details, not a public consumer API for unrestricted use.

**IBB translation:** use a stable domain model of store → product → variant/SKU → inventory record; do not identify a product by its title alone. Separate draft, pending review, approved, rejected, paused and archived states. A product can be approved while a particular variant is out of stock, and the same item can have multiple prices or availability states over time.

### 2.6 Inventory, orders and settlement

Official seller documentation exposes separate concepts for order retrieval, stock querying/updating, warehouse identity, shipping-order creation/modification, shipping providers and estimated shipping fees. At least one order-list API documents a finite time range and result cap, with a recommendation to paginate/continue from the last retrieved record. Inventory documentation distinguishes seller-managed stock from inventory held/managed by SHEIN warehouses.

**IBB translation:** do not make an “orders” table the entire commerce architecture. Model order lines, status changes, stock reservations, fulfillment/shipment, payment/settlement and returns as related but distinct records. Store inventory changes as auditable operations. Use idempotency keys and server-side validation before accepting writes; a client retry must not create two orders or decrement stock twice.

## 3. Page-template and user-flow inventory

The table deliberately distinguishes direct observations from journeys that require additional interactive browser testing. The public pages and current official documents do not establish every screen or state in every country.

| Template or journey | Public evidence reviewed | Useful pattern | Evidence status |
|---|---|---|---|
| Homepage / discovery | US homepage | Category entry, promotions, product cards | Direct public observation |
| Category navigation | Homepage taxonomy | Clear taxonomy, browsing by need/category | Direct public observation of navigation labels; full category interactions not exhaustively tested |
| Search input | Public homepage and image-search help | One search entry, visible visual-search option in app | Text-search internals not established |
| Product result/listing cards | Homepage sample | Image, title, price and promotion cue | Direct public observation for sampled cards |
| Search results, filters and sorting | Not comprehensively sampled through all interactive states | Relevance, filters, stable sorting and pagination are required design questions | Needs live flow-by-flow validation |
| Product details | Sampled product pages | Product identity, variant options, price/availability, attributes, reviews/store details where available | Direct public observation on samples |
| Variant selection and out-of-stock state | Sampled product page | Show availability per selection; prevent invalid add-to-cart | Direct observation of sample states |
| Wishlist/favorites | Not fully traversed | Persistent account-backed saved list | Requires authenticated/interaction validation |
| Cart and checkout | Not submitted or tested | Cart state, address, delivery, payment and order summary | Not assessed end-to-end; no purchase submitted |
| Login/account and recovery | Not traversed | Authentication and account lifecycle | Not assessed |
| Order tracking/returns/refunds | Public Help Center search surfaced selected help material, but not a complete customer journey | Status history, clear return eligibility and refund events | Partial public documentation only |
| Customer service | Official support/help area exists | FAQ, order-aware support and escalation | Public entry points exist; detail not audited |
| Seller landing page | US and Middle East portals | Distinct merchant onboarding path | Direct public observation/documentation |
| Seller application and verification | Public US onboarding guidance | Application → documents → review → approved onboarding | Documented at a high level; form submission not performed |
| Seller portal/catalog publishing | Public developer docs | Draft, validation, review, listing and updates | Documented seller capabilities; private portal not accessed |
| Seller inventory and order operations | Official API documentation | Separate product/variant/stock/order/shipping resources | Documented, not executed |
| Seller analytics/promotions | Seller landing page markets insights and promotions | Seller insights and promotional planning | Publicly advertised capability; underlying calculations unknown |

### 3.1 What “all pages” means for a reliable audit

A retailer like SHEIN has region-specific storefronts, many dynamically generated product/category URLs, app-only states, logged-in pages, seller portals and developer documentation. An exhaustive audit cannot be proven complete by visiting a homepage plus a few product pages. The accurate unit is **page template + state + locale + role**.

For a rigorous follow-up pass, create a coverage checklist for each template and test at least:
- logged-out and logged-in states where an authorized test account exists;
- desktop and narrow mobile layouts;
- empty, loading, error, populated and sold-out states;
- at least two categories and several product types with different variant schemas;
- a query that should match, one with synonyms, one with no results and one with a typo;
- seller application validation errors and successful/pending/rejected states, using a test seller account only when authorized;
- cart and checkout up to the last non-committing step; do not create an order or payment without explicit authorization.

This report is an initial comprehensive reference pass, not a claim that every live page and account-only state has been exhaustively tested.

## 4. Algorithms: known facts versus reasonable hypotheses

### 4.1 Text search and result ordering

**Known:** the visible product catalog exposes searchable discovery and product/category routes. The public materials reviewed do not disclose the exact consumer ranking formula.

**Unknown:** tokenizer, retrieval index, synonym expansion, personalization features, learning-to-rank model, candidate recall strategy, feature weights, exploration policy, region-specific boosts, experiment assignments, fraud/spam penalties, and real-time inventory or advertising weights.

**Reasonable generic hypothesis (not a claim about SHEIN's proprietary implementation):**
1. interpret the query and context;
2. retrieve candidates by lexical/product metadata relevance;
3. optionally expand query/category terms and retrieve semantic candidates;
4. apply eligibility constraints such as region and sale availability;
5. rank eligible candidates using relevance, quality/trust, stock, price/promotions, engagement and context;
6. apply sponsored placement rules, if any, with explicit sponsored labels;
7. return facets and sort options; track non-sensitive aggregate events for evaluation.

This is a template for designing an IBB search engine, not a recovered SHEIN formula.

### 4.2 Image search

**Known:** the official FAQ describes camera/gallery image input, and mentions recognition failures for blurry, poorly lit or unclear subject images. It says the feature is mobile-app-only at the time of the source.

**Unknown:** exact image model, image pre-processing, product segmentation, visual embedding model, vector index, distance metric, query-time reranking, score cutoffs, region/catalog filters, and how visual similarity combines with text.

**Suggested IBB method:**
1. normalize image orientation and size; strip irrelevant metadata;
2. detect invalid/oversized files and reject unsupported content;
3. create a visual embedding for merchant-approved product images;
4. keep the embedding keyed to product/variant IDs and model version;
5. retrieve top-k nearest candidates from IBB's own catalog;
6. rerank by category match, descriptive text, color, variant, store trust, location and inventory freshness;
7. return similarity explanations and a low-confidence state;
8. log only the event data needed to measure quality, with clear image retention/deletion policy.

Start with product-photo search, not facial recognition or identity-image analysis. Obtain consent for uploaded images and avoid retaining user query images longer than the documented purpose requires.

### 4.3 Recommendation and promotion surfaces

**Known:** the homepage visibly interleaves promotion/discovery modules with product cards. The seller portal markets promotion campaigns and data-oriented seller insights.

**Unknown:** per-user recommendation formula, session profile, exact campaign allocation, bid mechanics, controlled experiments, ranking weights and conversion optimization logic.

**IBB principle:** begin with deterministic, explainable ordering:
- exact textual relevance first for search results;
- verified/local availability and freshness;
- opt-in followed stores or categories for personalized discovery;
- clearly labeled paid promotion only if it meets the query/category constraints;
- new/updated items in a separate discovery section.

Do not sell a top search position while allowing irrelevant advertisements to outrank exact matches. Keep the reason for appearance observable for internal QA, for example “مطابق لعبارة البحث”, “متجر موثق قريب”, or “إعلان ممول”.

### 4.4 Merchant trust and listing review

**Known:** SHEIN's public seller materials describe application screening, document validation, and product/listing compliance review. Public developer functions expose product review state and certificate requirements.

**Unknown:** private risk scores, fraud model features, approval thresholds, manual-review queues, enforcement heuristics and internal risk/vendor tools.

**IBB design:** publish an explicit state machine:
- draft;
- submitted;
- phone/contact confirmed;
- ownership evidence pending;
- under moderator review;
- verified;
- rejected with reason;
- suspended/under dispute;
- archived.

A verified store does not make every product truthful; product-level reports and listing review must remain separate. Avoid binary “verified” labels without a visible explanation of what was checked and when.

## 5. IBB Market: current-state findings from the repository

### 5.1 Current delivered surface

The repository describes the current version as a static, Arabic RTL prototype on GitHub Pages, with a Cloudflare Worker endpoint referenced as an additional API surface. The public app has two primary tabs: Home and Map. It contains a names directory, a map loaded lazily through Leaflet/OpenStreetMap, locally persisted follows/likes/products/location overrides, a local add-store flow and a prototype assistant that searches available local text.

The data index and README state that the dataset includes 11,060 records split into 23 JSON files, with only the “name” field imported from the source workbook. No addresses, phone numbers, business status, product stock, reviews, ratings or imported coordinates are present in this seed dataset.

### 5.2 Search implementation

The current source normalizes Unicode compatibility forms, removes Arabic diacritics and tatweel, collapses whitespace, lowercases using Arabic locale, folds Alef forms, maps ى to ي and maps ة to ه. Search then filters entries by substring inclusion; the directory initially renders 30 entries and supports a load-more action plus local/followed/located filters.

**Strength:** the existing implementation is lightweight, understandable and reasonably fit for finding a name from the imported list.

**Limitations:** it is not a product search engine; it lacks full-text ranking, a synonym/alias dictionary, category/address/phone search, typo-tolerant retrieval, facets over real product attributes, inventory-aware results and search analytics. Mapping ة to ه may improve some colloquial matching but can also create false positives; it should be evaluated on representative Arabic queries rather than assumed correct for every word.

### 5.3 Store, product and map flows

The store detail dialog warns that the source name is unverified. Following a store, liking a product, claiming ownership, adding a product and adding coordinates are stored using local browser storage. A newly created local store can require manual map pin placement, but the resulting record remains on the current device. The product grid shows only products added locally; price is optional, and an image URL may be used in the prototype.

The image-search button is disabled and labeled “قريبًا”; the assistant is explicitly described in the UI as local text matching, not an independent AI model connected to inventory or prices. These warnings are important and should remain until the matching capabilities genuinely exist.

### 5.4 Backend and operational gaps

The repository audit and README state that there is not yet:
- shared user/seller authentication and authorization;
- shared store/location/product data persistence;
- verified ownership or moderation workflow;
- a real catalog upload pipeline from the current product form;
- a working image-search service;
- verified stock/pricing synchronization;
- a full order, payment, return or delivery flow;
- a complete device/network validation suite.

A Cloudflare Worker URL and health endpoint are documented, but Worker source and deployment bindings are not present in the inspected repository tree. Therefore this review does not certify Worker authorization, secret binding, R2 uploads, database connections, or current DNS behavior.

### 5.5 Maintainability and release risks

- The UI/state/storage/search/map/dialog code is largely concentrated in index.html. Avoid rewriting it all at once; add tests and separate components/modules incrementally.
- localStorage may not be suitable for retaining a large names cache on every mobile device. Test quota handling and consider IndexedDB or bounded caching.
- manually placed map pins are not equivalent to verified business coordinates; preserve provenance and verification state.
- public image URLs and imported/user-entered text require validation, safe rendering and policy checks.
- a service worker and manifest establish a PWA foundation, not proof of reliable offline operation. Test installation, offline launch, cache updates and low-storage devices.
- the existing validation script checks dataset count/schema, blank/repeated normalized names, inline JavaScript syntax and PWA metadata, but does not establish that every interactive flow works end to end.

Source for current-state claims: IBB README, ROADMAP, docs/PROJECT_AUDIT_2026-10-19.md, index.html, data/index.json and scripts/validate.mjs in the repository.

## 6. SHEIN patterns worth adapting — and patterns not to copy

| Pattern | Adapt to IBB? | IBB-specific implementation |
|---|---|---|
| Category-led discovery | Yes, after verified categories exist | Categories tuned to local groceries, clothing, electronics, household goods, services and local merchant types |
| Image-rich product cards | Yes | Only approved, compressed images with alt text and a fallback |
| Variant-aware product detail | Yes | Variant model for size/color/weight/packaging; stock per variant |
| Visual search | Later | Catalog-only image embeddings, confidence threshold and privacy controls |
| Seller onboarding path | Yes | Local application, contact confirmation, ownership claim, moderator review, status tracking |
| Product listing review | Yes | Draft → submitted → reviewed → published |
| Seller inventory and order APIs | Yes as architecture | Shared server-side API, audit log, idempotency, inventory reservations |
| Personalized ranking | Later | Start explainable and deterministic; evaluate before introducing ML |
| High-volume promotional density | Not initially | Use small, relevant and clearly labeled promotion inventory |
| Global checkout/payment logistics | No direct copy | Validate local payments, cash on delivery, fulfillment and return realities first |
| Market-specific documentation requirements | No direct copy | Define Yemen rules after local legal/provider review |
| Pixel-identical UI/source/assets | No | Use independent IBB visual identity and copy only general interaction ideas |

## 7. Source register

All sources below are public pages or official documentation. Accessed/retrieved in this reference pass on 2026-10-21 unless the page itself shows a different update date.

1. SHEIN US storefront: https://us.shein.com/
2. Sample SHEIN product page: https://us.shein.com/Bad-Company-Straight-Shooter-Badge-T-Shirt-Vintage-Washed-Homme-Top-For-Everyday-Wear-Unisex-Comfortable-Breathable-Soft-p-567905202.html
3. SHEIN Help Center — finding a product from a picture: https://us.shein.com/faq/detail?id=161960
4. SHEIN US seller onboarding guide: https://seller-us.shein.com/get-started-shein-marketplace
5. SHEIN US Marketplace seller landing page: https://seller-us.shein.com/
6. SHEIN Middle East Merchant Portal: https://seller-me.shein.com/
7. SHEIN public seller/product compliance overview: https://safe.shein.com/systematic-approach
8. SHEIN Developer Platform API index: https://open.sheincorp.com/documents/apidoc/1000002
9. SHEIN product listing API documentation: https://open.sheincorp.com/documents/apidoc/detail/3000645-1000001
10. SHEIN inventory modification v2 documentation: https://open.sheincorp.com/documents/apidoc/detail/3001693
11. SHEIN order list API documentation: https://open.sheincorp.com/documents/apidoc/detail/3001083
12. SHEIN image requirements documentation: https://open.sheincorp.com/documents/faq-detail/4
13. IBB Market repository: https://github.com/h776117073-eng/IBB
14. IBB Market current project audit: https://github.com/h776117073-eng/IBB/blob/main/docs/PROJECT_AUDIT_2026-10-19.md
15. Upstream Reverse-Skill reference: https://github.com/DorianGallo/reverse-skill

## 8. Final assessment

SHEIN demonstrates how product discovery, item/variant data, seller operations, review/verification, inventory, orders and image-led search form a connected commerce system. Its precise internal algorithms are not recoverable from public pages and documentation alone; this report intentionally records the observable public contract and a clear boundary around unverified hypotheses.

IBB already has a useful foundation for an Arabic-first local directory: responsive RTL UI, names dataset, basic search, lazy map and a PWA shell. The current version is **not yet comparable to SHEIN as an e-commerce product**, and it should not claim to be. That is a difference in maturity and scope, not a failure of the core idea.

The most useful outcome is a staged, verifiable path: build trust and shared persistence first; then store verification and product catalogue; then high-quality text search; then image search; then transactional commerce after provider/legal readiness. Each stage should ship only when its end-to-end acceptance tests pass.

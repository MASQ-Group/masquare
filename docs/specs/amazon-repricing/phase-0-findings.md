# Amazon Repricing — Phase 0 Findings & Implementation Plan (maSquare)

**Status:** Draft for review gate · **Date:** 2026-08-02 · **Source spec:** [`spec-v1-source.md`](./spec-v1-source.md)
**Scope of this document:** investigation only, no production code (per spec §3 / Phase 0). Output = findings, an architecture translation onto maSquare's real stack, a per-SKU data-readiness audit, the §9 decisions annotated, and the deviations that need sign-off.

---

## 0. Headline

The source spec's **Amazon domain design is sound and we keep it** (floor solver, decision branches, clamps, safeguards, shadow→cohort rollout). Its **architecture section describes the wrong platform** — C#/.NET microservices, MongoDB, Google Cloud (Pub/Sub, Cloud Run, Cloud Scheduler, Secret Manager), shadcn/ui. maSquare is a **TypeScript / NestJS + Prisma / PostgreSQL monolith, React + Tailwind + `@masquare/ui`, single Docker image on Railway (EU-West)**. This document re-grounds the design onto that stack. **Decision taken (2026-08-02): build into maSquare; do Phase 0 investigation first.**

Good news: much of the plumbing the spec's Phase 0 hunts for **already exists** and is proven in production.

---

## A. Architecture translation (spec → maSquare)

| Spec component | maSquare equivalent | Notes |
|---|---|---|
| C#/.NET microservices | **NestJS modules** in `apps/api` (one `amazon-repricing` module, sub-services) | No microservice mesh; monolith with clear service boundaries |
| MongoDB collections (`skuPricing`, `offerSnapshots`, `decisions`, `sellers`, `feeCache`, `notifDedupe`) | **Prisma models / Postgres tables**; verbatim payloads → `jsonb` columns | TTL collections → a nightly `@Cron` sweep or `staleAfter`/`expiresAt` columns |
| GCP Pub/Sub (ordering key `{asin}:{marketplaceId}`) | **Postgres work-queue table** processed by a single worker loop, ordered per ASIN+marketplace by a row lock (`SELECT … FOR UPDATE SKIP LOCKED`) | Volume is low (event-driven, one seller); no Kafka/Redis needed. Add BullMQ+Redis later only if throughput demands |
| Cloud Scheduler / Cloud Run cron | **`@nestjs/schedule` `@Cron`** (already used: `integrations` daily `0 5 * * *`, `customs-fx` `0 6 2 * *`) | Nightly floor recompute, hold-timer probes, backfill sweep = cron jobs |
| GCP Secret Manager | **Existing encrypted-secrets store** (`writeSecrets`/`decryptedSecrets`, `SECRETS_MASTER_KEY`) | LWA client secret + refresh token already stored this way |
| AWS SQS bridge + `notif-ingest` | **KEEP — genuinely unavoidable.** SP-API Notifications deliver **only** to AWS SQS/EventBridge. We run one small SQS queue and a poller inside `apps/api` that long-polls it and enqueues to our Postgres work-queue | This is the one true external dependency; not a stack choice |
| shadcn/ui ops console | **React + Tailwind + `@masquare/ui`** pages, consistent with existing admin screens | Same patterns as Integrations / Channel Listings pages |
| Money as integer minor units (cents) + currency | **New module models money as integer cents** internally (self-contained); converts at the ERP boundary | maSquare elsewhere uses `Float` EUR (`averageCostEur`, etc.); the repricer keeps its own integer-cents discipline per spec §4.1 to avoid rounding drift. Boundary adapters convert to/from the ERP's floats |

**Net:** the whole GCP/AWS/microservice topology collapses into **one Nest module + a Postgres work-queue + cron jobs + one tiny AWS SQS queue**. Far simpler to run than the spec's diagram, same behaviour.

---

## B. What already exists and is reusable (with references)

| Spec need | Already in maSquare | Location |
|---|---|---|
| **LWA OAuth (refresh-token) for SP-API** | `amazonAccessToken()` — client id/secret + refresh token, encrypted | `integrations.service.ts:528` |
| **SP-API endpoint + marketplace IDs (DE/FR/ES)** | `getMarketplace()` table — DE `A1PA6795UKMFR9`, FR `A13V1IB3VIYZZH`, ES `A1RKKUPIHCS9HS`, EU endpoint | `connectors.ts:60` — **resolves spec §3.1 / §9-`TO VERIFY` marketplace IDs (they match)** |
| **`patchListingsItem` + `VALIDATION_PREVIEW`** (the price-writer path) | `amzWrite()` PATCH + `pushAmazonQuantity()` already PATCHes `/listings/2021-08-01/items/…` with `mode=VALIDATION_PREVIEW` | `integrations.service.ts:565,576` — price-writer = same call, patch `purchasable_offer.our_price` instead of `fulfillment_availability` |
| **SP-API 429 backoff** | `amzFetch` / `amzWrite` retry on 429 (2/4/8s) | `integrations.service.ts:557` — *upgrade to token-bucket honouring `x-amzn-RateLimit-Limit` per spec §6* |
| **Amazon listings (SKU↔ASIN↔marketplace, price, qty, FBM/FBA)** | `ChannelListing` (`channelSku`, `asin`, `marketplace`, `listedPrice`, `listedQuantity`, `fulfilmentChannel`) + pull `fetchAmazonListings()` | `channel-listings.service.ts`, `integrations.service.ts:703` |
| **Landed COGS (moving average)** | `Product.averageCostEur` (moving-average landed cost at goods receipt) + `purchaseCost` fallback | product master; `sales-transactions.service.ts` COGS logic |
| **Fulfilment method per SKU** | `Product.fulfilmentType` + per-SKU alias fulfilment | 111 refs across API |
| **VAT rate** | `Country.vatRate` (DE/FR/ES standard rates) + `VatClass` (reduced-rate categories) + `resolveDestinationVat()` | `sales-transactions.service.ts:1045,1151` — **not a standalone "VAT engine"; see Deviation D-2** |
| **Order/settlement data (velocity, realized margin)** | Sales transactions + analytics module | for velocity strategy + KPI baselines |
| **Cron scheduling** | `@nestjs/schedule`, `@Cron(...)` in prod | `integrations.service.ts:1588`, `customs-fx.service.ts:38` |
| **Structured decision/audit storage** | Prisma tables are business data (pattern already used, e.g. `ChannelPush` audit) | model `decisions` the same way |

---

## C. What is genuinely new to build (per phase)

- **Product Fees:** `getMyFeesEstimate` client + `feeCache` table + nightly/`FEE_PROMOTION` refresh. *(new SP-API op)*
- **Floor solver** (bisection, referral-bracket-aware, VAT-inclusive basis) as a **pure, exhaustively-tested function** — the crown jewel; stack-agnostic. *(Phase 1)*
- **Notifications:** `createDestination`/`createSubscription` for `ANY_OFFER_CHANGED`, `PRICING_HEALTH`, `FEE_PROMOTION`; the **AWS SQS queue + long-poll poller**; dedupe + snapshot persistence. *(Phase 2)*
- **Decision engine** (`repricer-engine`): competitor-set filter → market-structure branch A/B/C/D → target → clamp chain → emit-if-meaningful, as a **pure decision core + thin I/O shell**. *(Phase 3)*
- **Price writer** for `purchasable_offer.our_price` + `min/max_seller_allowed_price` backstops; token-bucket limiter; `JSON_LISTINGS_FEED` bulk path. *(Phase 4)*
- **Independent safety layer**, quarantine, fair-pricing ceiling, kill switches, append-only `decisions` audit. *(Phase 4)*
- **Enrichment (optional, budgeted):** FOEP `getFeaturedOfferExpectedPriceBatch`, `getCompetitiveSummary`. *(Phase 3, low rate limits)*
- **Ops console** pages in `@masquare/ui`. *(Phase 5)*
- **Money-in-cents value type** + ERP boundary adapters.

---

## D. Per-SKU data-readiness audit (indicative — dev mirror)

Method: `channel_listing` (Amazon integrations) ⨝ `product`. **Run against production before Phase 1 sign-off** (numbers below are the dev mirror and are indicative only).

| Metric | Count | Read |
|---|---|---|
| Amazon listing rows | 11,744 | Total pulled |
| **Matched to a product** | **4,968 (~42%)** | Automatable candidate pool; the rest are unlinked pulls → auto-excluded until matched |
| Of matched: have **COGS** (`averageCostEur`/`purchaseCost`) | 4,968 (**100%**) | Floor is computable for the whole matched pool |
| Of matched: have **fulfilment type** | 4,968 (**100%**) | Adjustment matrix ready |
| SKU↔ASIN mapping | present via `channel_listing.asin` | `external_listing_id` (the unified id) not yet backfilled — see the eBay-ItemID sync note; ASIN itself is populated |

**Readiness verdict:** the *matched* Amazon catalogue is essentially 100% floor-ready today (COGS + fulfilment + VAT-by-country all present). The main readiness gap is **listing↔product matching coverage (~42% on dev)** — improving match rate directly grows the automatable population. MAP, per-SKU ad spend (TACOS), returns-rate-by-category, and velocity targets are the fields most likely missing (spec §3.3) and default-or-exclude per the table there.

---

## E. Deviations from the spec that need sign-off (spec demands these be explicit)

- **D-1 — Topology.** Replace GCP Pub/Sub + Cloud Run + microservices with **one Nest module + Postgres work-queue + `@Cron`**. Keep exactly one AWS piece (SQS queue + poller) because SP-API notifications require it. *Rationale: one seller, event volume is low; matches how maSquare already runs.*
- **D-2 — No shared "VAT determination engine."** The spec assumes a shared engine resolving `(marketplace, product tax code) → rate`. maSquare has `Country.vatRate` (standard rates) + `VatClass` (reduced rates) + `resolveDestinationVat()`, not a single service. The solver will **consume those existing pieces** (no new rate tables), but there's no clean interface to "reuse" — we add a thin `resolveVatRate(marketplace, product)` adapter over what exists. **Still `TO VERIFY` with finance: the VAT basis of Amazon's referral fee (§4.3, §9-#20).**
- **D-3 — Money type.** New module uses **integer cents internally** (spec §4.1) while the ERP uses `Float` EUR. Boundary adapters convert. Accept the small dual-representation seam.
- **D-4 — UI kit.** shadcn/ui → **`@masquare/ui` + Tailwind**. No functional change.
- **D-5 — Rate limiting.** Upgrade the existing simple 429-backoff to a **token bucket** reading `x-amzn-RateLimit-Limit`, with a single writer per marketplace (spec §2.2).
- **D-6 — Naming.** Spec says "Masqaure"; product is **maSquare**. Cosmetic.

---

## F. §9 "Decisions to confirm" — annotated

Engineering-owned defaults I'd adopt as-is; business/finance items flagged for you.

| # | Decision | Spec default | My recommendation |
|---|---|---|---|
| 1 | Min net margin (strategy floor) | 12% ex-VAT | **Finance** — start 12%; can vary per product group |
| 2 | Strategy per product group | BUY_BOX / VELOCITY / MANUAL_ONLY | **Commercial** — sensible; MANUAL_ONLY for top-revenue until Cohort 4 |
| 3 | FBM premium (we FBA vs FBM comp) | +3% | Adopt; delivery-tier based per EU note |
| 4 | We-FBM vs FBA-comp | −5% / wait price | Adopt |
| 5 | Amazon-Retail wait premium | +2% | Adopt |
| 6 | Probe step/interval | 1% / 45 min | Adopt |
| 7 | Epsilon | max(10c, 0.5%) | **Engineering — adopt** |
| 8 | Cooldown | 300 s | **Engineering — adopt** |
| 9 | Undercut-loop N/M/quiet | 3 / 60min / 6h, hold | Adopt |
| 10 | Competitor filters | 90% / 50 / 96h / domestic-only | Adopt; revisit per category |
| 11 | Fair-pricing ceiling | min(max, 30d-median BB ×1.10) | Adopt |
| 12 | Quarantine max step | 15% hard / 10% warn | **Engineering — adopt** |
| 13 | Floor staleness | 7 days | Adopt |
| 14 | Returns allowance / ad cost in floor | category table / ads excluded v1 | **Finance** — needs a returns-rate source |
| 15 | Notification aggregation | none (measure first) | **Engineering — measure in Phase 0 exec** |
| 16 | Velocity targets | per-SKU from demand plan | **Commercial** |
| 17 | Wait-for-sellout | off | Adopt (weak signal) |
| 18 | Cohort composition/KPIs | §6.5/§7 | Adopt |
| 19 | Blocklist governance | brand-protection owner | **Commercial + Legal** |
| 20 | Referral-fee VAT basis | `TO VERIFY` | **Finance — blocking for the solver** |

---

## G. Proposed repo layout

```
apps/api/src/amazon-repricing/
  amazon-repricing.module.ts
  floor/                  floor-solver.ts (pure) + floor.service.ts (fee refresh, staleness cron)
  ingest/                 sqs-poller.service.ts (long-poll) + notif-dedupe + snapshot.service.ts
  engine/                 decision-core.ts (pure) + repricer.service.ts (I/O shell, work-queue worker)
  writer/                 price-writer.service.ts (patch + feed) + safety-layer.ts (pure, boring)
  enrichment/             foep.service.ts, competitive-summary.service.ts (budgeted)
  ops/                    controllers for strategy/kill-switch/quarantine/audit
  prisma models:          SkuPricing, OfferSnapshot, RepricingDecision, BlockedSeller, FeeEstimate, NotifDedupe
apps/web/src/pages/repricing/   ops-console screens (@masquare/ui)
docs/specs/amazon-repricing/    spec-v1-source.md, phase-0-findings.md (this), decisions.md (living)
```

Reuse (do **not** rebuild): `integrations.service` SP-API auth/fetch/write + marketplace table; `ChannelListing`; product COGS/fulfilment; `Country.vatRate`/`VatClass`; `@nestjs/schedule`; encrypted-secrets store.

---

## H. Phase 0 checklist status

| Item | Status |
|---|---|
| SP-API app + roles (Pricing, Listings, Inventory) | **Partly there** — LWA + Listings/Orders proven; **verify Pricing + Product Fees + Notifications roles** on the app |
| EU endpoint + DE/FR/ES marketplace IDs | ✅ resolved (`connectors.ts`, match spec) |
| Sandbox access | `TO VERIFY` |
| Observed rate limits (`x-amzn-RateLimit-Limit`) | `TO DO` — capture live |
| AWS SQS queue + resource policy for SP-API principal | `TO DO` (external, unavoidable) |
| `createSubscription` for 3 notification types | `TO DO` |
| ≥1,000 real `ANY_OFFER_CHANGED` payloads corpus | `TO DO` (needed for replay harness) |
| `IsFeaturedMerchant`/`TotalBuyBoxEligibleOffers` post-rank-only semantics | `TO VERIFY` (Phase 0 exec, live payloads) |
| Per-SKU data-readiness audit | ✅ method proven; **re-run on prod** |
| Account-health review (ODR/OTD per marketplace) | **Business — do before automating** (ranking multiplier under rank-only) |
| Seller blocklist seed | **Commercial** |
| Legal review (§6.7 unilateral conduct, MAP) | **Legal** |
| Freshness re-check (Amazon algo/fee changes) | recommended before Phase 1 (skill mandates; spec dated 2026-08-01) |

---

## Recommended gate

Approve: (1) the **architecture translation (§A) + deviations (§E)**; (2) that I proceed to run the **remaining Phase-0-execution items** that need live Amazon access (SP-API roles, notification/SQS setup, rate-limit capture, payload corpus) — several of which are **your/ops/finance/legal tasks**, not code; and (3) the **§9 engineering defaults**, routing the finance/commercial/legal ones to their owners.

**Then Phase 1** = the floor solver + data model, which is stack-agnostic, self-contained, and the highest-value first build. Nothing above is production code yet.

# Claude Code Implementation Prompt — Amazon Buy Box Algorithmic Repricing Module (Masqaure ERP)

> **How to use this file:** paste Part 1 into Claude Code as the task prompt, with this whole file available in the repo (e.g. `docs/specs/amazon-repricing/`). Part 2 is the authoritative technical specification — Claude Code must treat it as the source of truth and this prompt as the working procedure.

---

# PART 1 — The prompt

You are implementing a new module in the **Masqaure ERP**: an **algorithmic repricing engine for Amazon** that maximizes our Featured Offer (Buy Box) share on amazon.de / amazon.fr / amazon.es while never pricing below a computed profitability floor.

**Stack context:** Masqaure is React on the front end, C#/.NET microservices, MongoDB, Google Cloud (Cloud Run, Pub/Sub, Cloud Scheduler, Secret Manager). The full technical specification is in **Part 2 of this document — read it completely before writing any code.** It defines the architecture (event-driven SP-API notification pipeline with an AWS SQS bridge), the data model, the breakeven floor solver, the decision engine, and the safeguards. Do not deviate from it silently; propose deviations explicitly at phase gates.

## Ground rules

1. **Work in phases with hard stops.** Each phase below ends with a **STOP — review gate**: summarize what you built, what you verified, what surprised you, and wait for approval before continuing. Never run ahead across a gate.
2. **Phase 0 is investigation only** — no production code. Its output is a findings report and an implementation plan mapped onto the existing codebase.
3. **Never fabricate specifications.** Where the spec marks something `TO VERIFY` (marketplace IDs, current SP-API role names, VAT basis of referral fees, `IsFeaturedMerchant` semantics post-July-2026, Amazon Retail EU seller IDs), keep the marker in code comments and the phase report — do not invent a value to make code compile against.
4. **Reuse before rebuild.** Masqaure already has a shared **VAT determination engine** (consumed by multiple modules) — the floor solver must obtain VAT rates from it, not from new hardcoded tables. Investigate in Phase 0 what other shared services apply (auth, config, logging, tax codes, product master).
5. **Money is integer minor units (cents) + currency code everywhere.** No floating-point euros, per spec §4.1.
6. **The safety invariants are non-negotiable and triple-enforced** (engine clamp, safety layer, Amazon min/max backstop): never below breakeven, never above the fair-pricing ceiling, never a single step ≥ 10% upward, unknown/stale floor ⇒ SKU excluded from automation.
7. **UI work** (ops console screens) follows the ERP design system: shadcn/ui + Tailwind, consistent with the existing dashboard patterns found in Phase 0.
8. **Every phase ships with tests.** The floor solver and decision core are pure functions by design — exhaustive table-driven tests are required, not optional. The recorded-payload replay harness (spec §6.5) is a deliverable, not an afterthought.

## Phases

### Phase 0 — Investigation & prerequisites (no production code)
Read spec §3 (Phase 0) and §2 (architecture). Then, in the repo:
- Map the existing microservice conventions: service template, Pub/Sub usage, Cloud Run deployment, Secret Manager access, structured logging, health checks, test layout.
- Locate and document the **VAT engine's interface** and how other modules consume it; confirm it can resolve (marketplace, product tax code) → rate. If it cannot, record the gap as a decision, don't work around it silently.
- Locate the product master: where landed COGS, fulfillment method, SKU↔ASIN↔marketplace mapping, MAP, stock and velocity live today. Produce the **per-SKU data-readiness audit** the spec requires (§3.3) — which fields exist, which are missing, what % of the catalog is automatable today.
- Identify any existing Amazon/SP-API integration code and whether it's reusable.
- Draft the AWS-bridge plan (SQS queue, credentials, `notif-ingest` service) and the subscription list (`ANY_OFFER_CHANGED`, `PRICING_HEALTH`, `FEE_PROMOTION`).
- Output: findings report + proposed service/repo layout + the spec's §9 "Decisions to confirm" table annotated with your recommendations + anything in the spec that conflicts with repo reality.
**STOP — review gate.** Do not scaffold services until the findings and decisions are approved.

### Phase 1 — Data model & floor service
Read spec §4. Build: MongoDB collections with indexes (`skuPricing`, `offerSnapshots`, `decisions`, `sellers`, `feeCache`, `notifDedupe`); the **breakeven solver** (bisection, referral-bracket-aware, VAT via the shared VAT engine, per spec §4.3) as a pure, exhaustively tested function; the `floor-service` (nightly + event-driven recompute, `getMyFeesEstimate` integration, staleness ⇒ `EXCLUDED`); strategy assignment plumbing.
Tests: solver property tests (monotonicity within brackets, bracket-edge discontinuities, VAT rates per marketplace, per-item minimum referral fee), floor-staleness state transitions.
**STOP — review gate:** include a floor spot-check export for ≥ 50 real SKUs per marketplace for finance review (spec Phase 1 exit gate).

### Phase 2 — Notification ingestion pipeline
Read spec §2.2–2.3 and §8.2. Build: the AWS SQS bridge + `notif-ingest` (dedupe on NotificationId, publish to Pub/Sub with ordering key `{asin}:{marketplaceId}`), snapshot persistence, stale-event discard, and the `backfill-poller` skeleton. Capture and commit a corpus of real payloads (≥ 1,000) as fixtures for the replay harness.
**STOP — review gate:** demonstrate end-to-end delivery latency and dedupe behavior against live notifications in a test subscription.

### Phase 3 — Decision engine
Read spec §5 in full. Build `repricer-engine` as: pure decision core (competitor-set filter → market-structure branch A/B/C/D → raw target → ordered constraint clamps → emit-if-meaningful) + thin I/O shell. Implement the FBA/FBM **delivery-tier** adjustment matrix (EU equal-treatment basis, §5.4), FOEP anchoring with sanity checks, hold-and-probe-up logic, undercut-loop guard, cooldowns and epsilons, concurrency/idempotency rules (§5.7).
Tests: table-driven tests for every branch × competitor mix × edge case; golden-file tests over the recorded corpus; the **replay harness** runs the full corpus and asserts zero floor breaches and sane decision distribution.
**STOP — review gate:** replay-harness report reviewed.

### Phase 4 — Price writer & safeguards
Read spec §6. Build: `price-writer` (`patchListingsItem` with `VALIDATION_PREVIEW` support, `JSON_LISTINGS_FEED` bulk path, token-bucket rate limiting from `x-amzn-RateLimit-Limit`, acceptance confirmation); the independent **safety layer** (§6.3); price-error quarantine (§6.1); fair-pricing ceiling maintenance (§6.2); kill switches at global/marketplace/SKU scope with one-click bulk revert (§6.4); append-only decision audit records (§6.6).
**STOP — review gate:** demonstrate the kill switch, a quarantine round-trip, and a `VALIDATION_PREVIEW` dry-run against production listings.

### Phase 5 — Ops console, monitoring & shadow rollout
Read spec §6.5 and §7. Build: ops-console screens (strategy & parameter assignment, quarantine queue, blocklist governance, audit search, kill switches) in shadcn/ui + Tailwind; monitoring dashboards and the auto-trip alert conditions (§7); **shadow mode** — full engine on live events logging intended prices with a daily intended-vs-actual diff report.
**STOP — final gate:** shadow mode runs ≥ 2 weeks; exit criteria per spec §6.5 step 5; live cohort rollout is a business decision taken outside this prompt.

## Definition of done (whole module)
Spec §6.5 sequence complete through shadow mode; all §9 decisions recorded with their approved values in versioned configuration; no `TO VERIFY` marker resolved by guesswork — each either verified (with source) or surfaced as an open item.

---

# PART 2 — Technical specification (authoritative)

*The specification below was generated and validated against the amazon-buy-box-algorithm knowledge base (snapshot August 2026, freshness-checked: EU rank-only Featured Offer live since July 20, 2026; 2026 EU fee schedule changes). Estimates are labeled; unverifiable items are marked `TO VERIFY`.*

# Masqaure ERP — Algorithmic Repricing Process Specification

**Amazon Featured Offer (Buy Box) repricing engine for all Amazon-listed products**

| | |
|---|---|
| Document status | Draft for review — see "Decisions to confirm" (§9) before build |
| Version | 1.0 |
| Date | 2026-08-01 |
| Target marketplaces | amazon.de, amazon.fr, amazon.es (design extensible to other EU stores and amazon.co.uk) |
| Target stack | C# / .NET 8+, MongoDB, Google Cloud microservices (Pub/Sub, Cloud Run / GKE, Cloud Scheduler, Secret Manager) |
| Audience | Masqaure ERP developers — no prior Amazon marketplace knowledge assumed |
| Goal | Maximize Featured Offer (Buy Box) share on our listings while never selling below a computed profitability floor |

**Accuracy note, read first.** Amazon has **never published** the Featured Offer formula or its factor weights. Everything in this document is either (a) Amazon-official (API contracts, policy text, fee schedules — cited as such), or (b) industry-consensus estimate (factor weights, FBA price premiums — always labelled *estimate*). Anything we could not verify is marked **`TO VERIFY`** and must be confirmed during Phase 0. All price comparisons in this engine are on **landed price** (item price + shipping), never sticker price.

---

## Table of contents

1. [Background: how the Buy Box is won (primer for developers)](#1-background)
2. [System overview and architecture](#2-system-overview)
3. [Phase 0 — Investigation & prerequisites](#3-phase-0)
4. [Phase 1 — Data model & floors](#4-phase-1)
5. [Phase 2 — Decision engine](#5-phase-2)
6. [Phase 3 — Safeguards & rollout](#6-phase-3)
7. [Monitoring, alerting and KPIs](#7-monitoring)
8. [Appendices (SP-API surface, payload fields, glossary)](#8-appendices)
9. [Decisions to confirm](#9-decisions-to-confirm)

---

<a name="1-background"></a>
## 1. Background: how the Buy Box is won (primer for developers)

### 1.1 What the Buy Box is and why it matters

On an Amazon product page, many sellers can offer the same product (same ASIN). The **Featured Offer** — universally called the **Buy Box** — is the offer wired to the "Add to Cart" / "Buy Now" buttons. On multi-seller listings roughly **82–90% of transactions** go through it (*industry estimate*); offers not featured convert poorly via the buried "All Buying Options" list. With AI shopping agents (Rufus, agentic checkout) transacting directly against the Featured Offer, Buy Box ownership is becoming *more* decisive, not less.

Key mechanics the engine design depends on:

- **The winner rotates.** When several offers score similarly, Amazon rotates the Featured Offer between them; each seller's *share* of Buy Box time is roughly proportional to relative score. You do not "win" permanently — you win a share.
- **The algorithm is memoryless.** Past wins confer no lasting advantage. A stockout or a metrics dip removes you immediately.
- **The winner can differ per shopper location** (delivery speed to their postcode), so observed ownership is noisy.
- **Landed price is what is compared.** An FBM offer at €27.00 + €4.99 shipping (€31.99 landed) loses on price to an FBA offer at €28.50 with free shipping.

### 1.2 Ranking factors

Amazon officially states the Featured Offer is selected on "competitive pricing, delivery speed, and performance" — price "commonly at or below the lowest priced alternatives", shipping speed and predictability, customer experience/account health, and stock availability. Third-party consensus estimates of weights (directional only, they vary by category, price band and time):

| Factor | Importance (*estimate*) | Notes |
|---|---|---|
| Landed price | Very high (~25–35%) | Must sit within a few % of the lowest eligible landed price; being lowest alone rarely wins |
| Fulfillment / delivery reliability (FBA / Seller-Fulfilled Prime / FBM) | Very high | FBA and SFP treated as top-tier delivery reliability |
| Shipping speed / promised delivery | Very high, rising (~25–30% after a 2025 rebalancing) | Same/next-day materially raises win rate |
| Order defect rate (ODR), on-time delivery, late shipment, tracking, cancel rate | Critical / high | Recent orders weighted more; OTD ≥ 90% floor, 97%+ competitive |
| Seller feedback rating & count | Medium | Winners typically 95%+ |
| Inventory depth & consistency | Medium | Stockout history hurts; with tied metrics, share roughly tracks inventory depth |
| Refund/return rate | Medium | Below category average helps |

A mid-2025 rebalancing (*multiple third-party trackers*) shifted weight from raw price (~35% → ~25%) toward delivery speed (~15% → ~25–30%). Practical consequence for the engine: **we do not need to be the cheapest** — we need to be within the contention band (roughly **1–5%** of the lowest eligible landed offer, *estimate*) with strong delivery and metrics, and the band widens as our non-price factors improve.

### 1.3 The July 2026 change: rank-only Featured Offer (live in our marketplaces)

Until July 2026 Amazon ran a two-stage model: a per-SKU **eligibility gate** (professional plan, account-health thresholds, selling history), then ranking among eligible offers. **As of July 20, 2026, Amazon removed the seller eligibility gate in EU/UK marketplaces — including amazon.de, amazon.fr, amazon.es** — rolling out globally by end of 2026. All offers now enter one continuous ranking; performance signals (ODR, chargebacks, Voice of the Customer) became **weighted ranking inputs instead of pass/fail gates**. Amazon says the selection basis is unchanged.

Consequences for this spec:

- Strong metrics now buy *ranking score*, not mere admission. Our account health is a permanent multiplier on every SKU's win rate — the engine cannot compensate for bad metrics with price alone.
- New/opportunistic sellers (including hijackers) can enter the ranking pool immediately without performance history. The competitor-set filters (§5.2) and blocklist matter more than before.
- The `IsFeaturedMerchant` flag in offer data (historically "Buy Box eligible") may change semantics during this transition — **`TO VERIFY`** in Phase 0 how it now behaves in EU payloads before using it as a hard filter.

### 1.4 EU-specific rules (they shape our logic)

Our three marketplaces are all EU stores, where legally binding commitments (EU Commission Case AT.40703; similar UK CMA commitments) create differences vs the US:

| Aspect | EU (applies to us) |
|---|---|
| **Second Featured Offer** | Amazon must show a second, competing Featured Offer when a runner-up differs sufficiently on price or delivery. This is a real, winnable placement — the engine treats "runner-up with a differentiated offer" as a valid objective, not just a loss. |
| **Equal FBA/FBM treatment** | Fulfillment method may not be advantaged *per se*; only actual **delivery outcomes** (speed, reliability) may count. A fast, reliable FBM offer competes on materially fairer terms than in the US. The FBA/FBM adjustment matrix (§5.4) sizes premiums on delivery outcome, not the FBA badge. |
| **Non-public seller data** | Amazon is prohibited from using our non-public data against us; irrelevant to engine logic but relevant context. |
| **Rank-only rollout** | EU/UK were the first wave (July 20, 2026 — already live for us). |

### 1.5 Suppression (the "no Buy Box at all" state)

Sometimes Amazon features *no* offer: the buttons are replaced by "See All Buying Options". Main causes (Amazon Marketplace Fair Pricing Policy + a 2024–26 Georgetown measurement study):

- Price **above** the product's reference/historical price on Amazon, or above its price elsewhere on the web.
- Suspected pricing **error** (too low) also suppresses.
- Measured dominant triggers are on-Amazon events: the last featured seller leaving, or the featured seller **raising price ≥ 10% in one step** (*Georgetown, 2024 data: ≈ +53× suppression odds*). The implicit reference point approximates the last featured offer's price.

Suppression is severe: search rank drops within an hour, and **sponsored ads stop serving entirely** within ~12 hours (ads require the SKU to hold the Featured Offer). Recovery after correcting price typically shows within 24–48h. The engine therefore (a) never raises price ≥ 10% in one step (§6.2), and (b) treats "restore eligibility" as a distinct branch with its own targeting (§5.3).

---

<a name="2-system-overview"></a>
## 2. System overview and architecture

### 2.1 Design principles

1. **Event-driven, not polling.** Amazon pushes offer-change notifications; we reprice in reaction. Polling is only a low-frequency backfill. (This is also Amazon's recommended architecture and their read-API rate limits are deliberately too low for polling a catalog.)
2. **Prefer Amazon's own signals over re-derivation.** The `ANY_OFFER_CHANGED` payload usually contains everything needed to reprice; the **Featured Offer Expected Price (FOEP)** API is Amazon telling us the price expected to win; `PRICING_HEALTH` tells us when we've lost eligibility and why. Use these before inventing our own models.
3. **Rules as constraints, algorithm inside them.** Naive rule repricing ("beat lowest by €0.01") causes bot-vs-bot margin collapse. We compute an algorithmic *target* price, then clamp it inside hard constraints (MAP, floors, ceilings).
4. **Never sell below breakeven to win the Buy Box.** A SKU whose floor is unknown or stale is **excluded from automation**, never guessed.
5. **Anchor on the Buy Box landed price, not the lowest price.** Strong offers win above the lowest offer; lowest-price anchoring is reserved for specific branches (suppressed listings, FBM-vs-FBM).
6. **Price up when winning.** The single biggest differentiator of good repricers: while holding the Buy Box, never lower the price — probe upward in small steps, bounded by the runner-up's threat price.
7. **Every decision is auditable.** Full decision context persisted for every evaluation, priced or not.

### 2.2 Microservice decomposition (Google Cloud)

SP-API notification destinations are **AWS-native (SQS or EventBridge)** — there is no direct Google Pub/Sub destination. We therefore run a minimal AWS bridge and keep everything else on GCP:

```
                        AWS (bridge only)                    Google Cloud (Masqaure)
┌─────────────┐   ┌──────────────────────┐   ┌─────────────────────────────────────────────┐
│  Amazon      │   │  SQS queue            │   │  notif-ingest (Cloud Run)                   │
│  SP-API      ├──►│  (per notification    ├──►│  long-polls SQS → validates → publishes to  │
│  Notifications│   │  type)                │   │  Pub/Sub topic `amz.offer-events`           │
└─────────────┘   └──────────────────────┘   └───────────────┬─────────────────────────────┘
                                                              │ Pub/Sub (ordering key = ASIN+marketplace)
                                             ┌────────────────▼─────────────────────────────┐
                                             │  repricer-engine (Cloud Run, stateless)       │
                                             │  debounce → competitor set → branch →         │
                                             │  target → clamps → emit-if-meaningful         │
                                             └───────┬───────────────────────┬──────────────┘
                                                     │ MongoDB               │ Pub/Sub `amz.price-updates`
                                        ┌────────────▼───────────┐  ┌────────▼───────────────┐
                                        │  skuPricing / floors / │  │  price-writer (Cloud    │
                                        │  decisions / snapshots │  │  Run) → patchListings-  │
                                        │  collections           │  │  Item / JSON feed;      │
                                        └────────────────────────┘  │  confirms acceptance    │
                                                                    └────────────────────────┘
   Supporting services:
   • floor-service (Cloud Run + Cloud Scheduler): breakeven solver, fee refresh (getMyFeesEstimate), FEE_PROMOTION handling
   • enrichment-service: FOEP + getCompetitiveSummary batch calls (low rate limits — strictly budgeted)
   • backfill-poller (Cloud Scheduler): getItemOffersBatch sweep for SKUs with no event in N days
   • ops-console (internal UI/API): strategy assignment, blocklist, quarantine review, kill switch
```

Component responsibilities:

| Service | Responsibility | Key tech notes |
|---|---|---|
| `notif-ingest` | Drain SQS, verify message integrity, dedupe on `NotificationId` (Mongo TTL collection), publish to Pub/Sub with ordering key `{asin}:{marketplaceId}` | .NET `AWSSDK.SQS`; runs as min-instances=1 Cloud Run service (SQS long polling, not request-driven) |
| `repricer-engine` | The decision loop (§5). Stateless; all state in MongoDB | Pub/Sub push or pull subscription; per-ASIN ordering avoids races |
| `price-writer` | Serialize price submissions, rate-limit (token bucket honoring `x-amzn-RateLimit-Limit`), choose per-SKU patch vs bulk feed, confirm acceptance, retry with jitter | Single writer per marketplace to keep global rate budget |
| `floor-service` | Nightly + event-driven floor recomputation (§4.3); marks SKUs `floorStale` | Cloud Scheduler cron |
| `enrichment-service` | FOEP and competitive-summary batches for high-value SKUs | Rate limits are very low (§8.1) — treat as scarce resource |
| `backfill-poller` | Catch SKUs notifications don't cover (no offer changes, >20 offers deep, subscription gaps) | Low frequency (default: 1 sweep/24h per marketplace) |
| `ops-console` | Human controls: strategy assignment, parameters, quarantine queue, kill switches, audit search | Reads/writes the same Mongo collections; UI per the ERP design system (shadcn/ui + Tailwind) |

**LWA/SP-API credentials** live in Google Secret Manager; the AWS bridge credentials likewise. All services log structured JSON to Cloud Logging; decision records go to MongoDB (they are business data, not just logs).

### 2.3 What triggers a repricing evaluation

| Trigger | Source | Priority |
|---|---|---|
| `ANY_OFFER_CHANGED` notification (competitor moved, featured offer changed, external price changed) | SQS→Pub/Sub | Primary — seconds-to-minutes reaction |
| `PRICING_HEALTH` notification (we became Featured-Offer-ineligible) | SQS→Pub/Sub | Primary — eligibility-restore branch |
| `FEE_PROMOTION` notification / fee schedule change | SQS→Pub/Sub → floor-service | Recompute floor, then re-evaluate |
| Floor/COGS/MAP change in ERP | Masqaure internal event | Re-evaluate SKU |
| Hold-timer expiry (price-up probe while holding Buy Box) | Cloud Scheduler / Cloud Tasks | Periodic, per SKU |
| Backfill sweep | Cloud Scheduler | Low frequency |
| Manual re-evaluation | ops-console | On demand |

---

<a name="3-phase-0"></a>
## 3. Phase 0 — Investigation & prerequisites

**Gate: everything in this phase is confirmed and signed off before any engine code is built.**

### 3.1 SP-API access and roles

- [ ] Confirm our SP-API application is registered (Seller Central → Develop Apps) and holds the roles: **Pricing**, **Product Listing**, **Inventory and Order Tracking** (naming per current Solution Provider Portal — **`TO VERIFY`** exact current role names during registration; Amazon renames these).
- [ ] Confirm OAuth (LWA) refresh-token flow works for our selling account across the EU region endpoint (`sellingpartnerapi-eu.amazon.com`) — one region covers de/fr/es; marketplace IDs: amazon.de `A1PA6795UKMFR9`, amazon.fr `A13V1IB3VIYZZH`, amazon.es `A1RKKUPIHCS9HS` (**`TO VERIFY`** against current SP-API marketplace-IDs doc page before hardcoding).
- [ ] Verify sandbox access for all operations listed in §8.1.
- [ ] Record our actual per-operation rate limits from live `x-amzn-RateLimit-Limit` response headers (they are per seller-app pair and can differ from documented defaults).

### 3.2 Notification infrastructure

- [ ] Provision the AWS bridge: one SQS queue (or EventBridge bus) in an AWS account we control, with the resource policy allowing SP-API's service principal to deliver.
- [ ] `createDestination` (SQS ARN), then `createSubscription` for each of: **`ANY_OFFER_CHANGED`**, **`PRICING_HEALTH`**, **`FEE_PROMOTION`**. (Add `B2B_ANY_OFFER_CHANGED` only if/when we run Amazon Business tier pricing.)
- [ ] Decide aggregation: `ANY_OFFER_CHANGED` supports 5/10-minute aggregation windows for large catalogs. Default: **no aggregation** if our event volume is manageable (< ~5 events/sec sustained), else 5-minute window. Measure in Phase 0 by subscribing and counting for a week.
- [ ] Build and load-test `notif-ingest` end-to-end (SQS → Pub/Sub) with the recorded real payloads; store a corpus of ≥ 1,000 real `ANY_OFFER_CHANGED` payloads — this corpus becomes the replay test harness (§6.5).
- [ ] Confirm payload shape against the official JSON schema (`AnyOfferChangedNotification.json` in the `amzn/selling-partner-api-models` repo). **Specifically verify (post-July-2026 rank-only change): current semantics of `IsFeaturedMerchant` and `TotalBuyBoxEligibleOffers` in EU payloads.**

### 3.3 Data the ERP must already hold per SKU (blocking)

The engine refuses to automate any SKU missing these. Audit Masqaure's product master now:

| Field | Why | If missing |
|---|---|---|
| Landed COGS (unit cost + inbound freight to FC/warehouse) | Floor computation | SKU excluded from automation |
| Fulfillment method per marketplace (FBA / FBM / SFP) | Adjustment matrix, fee model | Blocking |
| Marketplace-specific list mapping (SKU ↔ ASIN ↔ marketplace) | Everything | Blocking |
| VAT rate per marketplace & product tax code | Floor is computed on net revenue; DE 19%, FR 20%, ES 21% standard rates (reduced rates per product tax code) — **resolve via the existing Masqaure VAT determination engine (shared dependency); do not re-implement rate tables** — **`TO VERIFY` with finance/EU-VAT advisors per category** | Blocking |
| MAP / minimum advertised price, where contractually bound | Hard clamp | Default: none |
| Current FBA fee estimate per SKU | Floor | Pull via `getMyFeesEstimate` in Phase 1 |
| Returns rate by category (or SKU) | Floor (returns allowance) | Default from category table, flag as estimate |
| Per-unit ad spend (TACOS) if ads run on the SKU | Floor (optional component) | Default 0, flag |
| Stock on hand + inbound, sales velocity | Velocity strategy, wait-for-sellout logic | Degraded mode: velocity strategy disabled |
| Business owner / product group | Strategy assignment, rollout cohorts | Blocking |

Note on fees: Amazon **cut EU referral and FBA fees substantially effective Dec 15, 2025 / Jan 5, 2026** (average −€0.32/unit FBA parcel fulfillment in DE/FR/ES; several low-price referral brackets dropped, e.g. clothing ≤ €15 from 8% → 5%; new ≤ €20 Home bracket at 8%; Low-Price FBA extended to ≤ €20). This is exactly why fee amounts are **never hard-coded** — the floor-service always pulls current per-SKU fees from `getMyFeesEstimate` / fee reports (§4.3).

### 3.4 Account-level prerequisites

- [ ] Account health review per marketplace: ODR, on-time delivery rate, late shipment, valid tracking, cancel rate. Under the rank-only model these are ranking multipliers on every SKU; if any is near historical thresholds (ODR ≥ ~1%, OTD < ~97%), fixing operations outranks building the repricer.
- [ ] Compile the **seller blocklist**: known unauthorized resellers / MAP violators / hijackers per brand, by `SellerId` where known.
- [ ] Legal review of §6.7 (unilateral-conduct constraint on price-up logic) and of MAP handling.
- [ ] Confirm Featured Offer share baseline per SKU (Seller Central → Business Reports → Detail Page Sales & Traffic → "Featured Offer (Buy Box) percentage") — this is the KPI baseline for rollout comparison. The metric is noisy; capture ≥ 4 weeks.

**Phase 0 exit gate:** signed checklist; real-payload corpus captured; ERP data audit report showing per-SKU readiness %; rate-limit table filled with observed values.

---

<a name="4-phase-1"></a>
## 4. Phase 1 — Data model & floors

**Gate: floors computed and human-spot-checked for a sample of ≥ 50 SKUs per marketplace before Phase 2 build starts.**

### 4.1 MongoDB collections

All prices stored as integer **minor units (cents)** plus currency code — never floating point euros. Every competitor comparison uses landed cents.

```jsonc
// collection: skuPricing  (one doc per SKU × marketplace — the engine's config & state)
{
  "_id": "SKU123:A1PA6795UKMFR9",
  "sku": "SKU123",
  "asin": "B0EXAMPLE",
  "marketplaceId": "A1PA6795UKMFR9",       // amazon.de
  "currency": "EUR",
  "fulfillment": "FBA",                     // FBA | FBM | SFP
  "strategy": "BUY_BOX",                    // BUY_BOX | LOWEST_PRICE | VELOCITY | MANUAL_ONLY
  "automationState": "SHADOW",              // EXCLUDED | SHADOW | LIVE | QUARANTINED | KILLED
  "exclusionReason": null,                  // e.g. "FLOOR_UNKNOWN", "COGS_MISSING"

  "floors": {
    "breakevenCents": 1523,                 // absolute never-cross line (0% margin), solved (§4.3)
    "strategyFloorCents": 1750,             // breakeven + minimum margin
    "computedAt": "2026-08-01T02:00:00Z",
    "staleAfter": "2026-08-08T02:00:00Z",   // stale ⇒ automationState → EXCLUDED
    "inputsHash": "…"                       // hash of fee+cost inputs, for audit
  },
  "ceilings": {
    "maxPriceCents": 2999,                  // business max
    "mapCents": null,                       // MAP if contractually bound (hard clamp)
    "fairPricingCeilingCents": 2725,        // dynamic, §6.2
    "amazonMinAllowedCents": 1400,          // mirrors minimum_seller_allowed_price we set
    "amazonMaxAllowedCents": 3200
  },

  "params": {                               // per-SKU overrides; null ⇒ strategy-group default (§9)
    "epsilonCents": null, "cooldownSeconds": null,
    "probeStepPct": null, "probeIntervalMinutes": null,
    "fbmPremiumPct": null, "minMarginPct": null
  },

  "state": {
    "currentPriceCents": 1899,
    "lastSubmittedPriceCents": 1899,
    "lastSubmissionAt": "2026-08-01T09:14:02Z",
    "lastSubmissionStatus": "ACCEPTED",     // PENDING | ACCEPTED | REJECTED
    "holdingBuyBox": true,
    "holdSince": "2026-08-01T07:00:00Z",
    "probeAnchorCents": 1899,               // last known-winning price, for step-back on loss
    "undercutLoop": { "sellerId": null, "count": 0, "windowStart": null },
    "suppressed": false,
    "lastEventAt": "2026-08-01T09:13:44Z"
  }
}
```

```jsonc
// collection: offerSnapshots (latest market picture per ASIN × marketplace; capped or TTL-indexed)
{
  "_id": "B0EXAMPLE:A1PA6795UKMFR9",
  "timeOfOfferChange": "2026-08-01T09:13:40Z",   // from payload; used for stale-event discard
  "summary": { /* verbatim Summary block from ANY_OFFER_CHANGED */ },
  "offers": [ /* verbatim top-20 Offers[] */ ],
  "source": "ANY_OFFER_CHANGED"                   // or BACKFILL_POLL
}

// collection: decisions (append-only audit log, §6.6) — one doc per evaluation
// collection: sellers  (blocklist + observed seller metadata)
// collection: feeCache (per-SKU getMyFeesEstimate results + fetchedAt)
// collection: notifDedupe (NotificationId, TTL 24h)
```

Indexes: `skuPricing` on `{asin, marketplaceId}`, `{automationState}`, `{floors.staleAfter}`; `decisions` on `{sku, marketplaceId, at}` and `{outcome}`; TTL on `notifDedupe` and optionally `offerSnapshots` history.

### 4.2 Strategy assignment

Every automated SKU carries exactly one strategy (set in ops-console, per SKU or inherited from product group):

| Strategy | When | Objective |
|---|---|---|
| `BUY_BOX` | Default for competitive multi-seller listings | Maximize Buy Box share at the highest price that wins it |
| `LOWEST_PRICE` | FBM offers where we compete in the FBM segment; suppressed listings; used condition (if ever) | Top of "All Buying Options" ordering (lowest landed + fast delivery) |
| `VELOCITY` | Sole-seller / private-label SKUs with no meaningful competition | Hit a target 30-day unit velocity between floor and ceiling |
| `MANUAL_ONLY` | Anything the business wants hand-priced | Engine evaluates and logs but never writes |

### 4.3 Floor computation (the breakeven solver)

**Why a solver, not a multiplication.** The referral fee is a *percentage of the sale price*, and in several EU categories the percentage is *tiered by price bracket* (e.g. after Jan 2026: clothing 5% ≤ €15, 10% for €15–20, 15% above — *current published EU schedule; re-verify at implementation*). Since the fee depends on the price and the price depends on the fee, the minimum viable price must be **solved**. Additionally, in EU marketplaces the displayed price is **VAT-inclusive**, and Amazon's referral fee is calculated on the VAT-inclusive total (**`TO VERIFY` with finance** — confirm current invoicing basis per marketplace), while our revenue is the net-of-VAT amount.

For a candidate gross (VAT-inclusive) price `P`:

```
NetRevenue(P) = P / (1 + vatRate)
              − referralPct(P) × P            // bracket-aware; apply per-item minimum referral fee
              − fbaFulfillmentFee             // from getMyFeesEstimate, per SKU (0 for FBM; FBM: our actual ship cost)
              − closingFee                    // media categories only
              − cogsLanded                    // unit cost + inbound freight
              − storagePerUnit                // monthly storage ÷ expected days-in-stock; Oct–Dec ≈ 3× rate
              − agedSurchargePerUnit          // if projected age > 180 days
              − returnsAllowance(P)           // category returns% × P net effect + refund-admin fee
              − adCostPerUnit                 // optional; product-group policy
              − fixedPerUnit                  // packaging, handling, overhead allocation

breakevenCents      = min P such that NetRevenue(P) ≥ 0
strategyFloorCents  = min P such that NetRevenue(P) ≥ minMarginPct × (P / (1 + vatRate))
```

Implementation notes:

- Solve by bisection over cents in `[1, amazonMaxAllowed]`; `NetRevenue` is monotone-increasing in `P` within a bracket but **discontinuous at bracket edges** — evaluate bracket edges explicitly and take the minimum feasible `P` across brackets. Deterministic, ~40 iterations, trivial cost.
- **Fees are data, not code.** `floor-service` refreshes per-SKU fees from **`getMyFeesEstimate`** (Product Fees API) and/or the SKU Economics / fee-preview reports on a nightly schedule and on `FEE_PROMOTION` notifications. The EU fee cuts of Dec 2025/Jan 2026 (§3.3) are the standing proof that hard-coded fees rot.
- VAT rates and product-tax-code resolution come from the existing Masqaure **VAT determination engine** (shared dependency) — the solver takes the resolved rate as an input and never owns rate tables.
- Recompute floors on: fee schedule change, `FEE_PROMOTION`, COGS/freight update from ERP, VAT-rate or tax-code change, storage-age tick (monthly), strategy margin change.
- Floors have a `staleAfter` (default 7 days). **Stale or unknown floor ⇒ `automationState = EXCLUDED`** and an ops alert. The engine never guesses a floor.
- Keep both floors: `breakeven` is the never-cross line enforced by the safety layer (§6.3) even against manual inputs; `strategyFloor` is what strategies operate above.

### 4.4 Competitor-set configuration (data side)

Phase 1 also delivers the reference data the Step-0 filter (§5.2) needs: the `sellers` blocklist collection (seed from Phase 0), per-strategy-group thresholds for minimum feedback %, minimum feedback count, maximum shipping hours, and the domestic-only flag (default: exclude offers shipping cross-border into the marketplace — their delivery promise rarely beats domestic; *heuristic, revisit per category*).

**Phase 1 exit gate:** floors for the target catalog computed; spot-check report (≥ 50 SKUs/marketplace) signed by finance — including at least 5 SKUs at referral-bracket edges and 5 low-price FBA SKUs; SKUs failing data audit listed with owners.

---

<a name="5-phase-2"></a>
## 5. Phase 2 — Decision engine

**Gate: engine complete and running in shadow mode (§6.5) before any live write.**

### 5.1 The evaluation loop

Triggered per §2.3. One evaluation = one ASIN × marketplace, using the freshest snapshot.

```
0. Debounce/coalesce: within a per-ASIN window (default 30 s), keep only the latest
   event by TimeOfOfferChange; discard events older than the stored snapshot.
1. Load skuPricing docs for our SKU(s) on this ASIN×marketplace.
   automationState ∈ {EXCLUDED, KILLED} → log decision "SKIPPED", stop.
2. Build effective competitor set (§5.2) from the snapshot's Offers[].
3. Branch on market structure (§5.3).
4. Compute raw target price for the branch + strategy (§5.4).
5. Apply constraint clamps in order (§5.5).
6. Emit-if-meaningful (§5.6): epsilon + cooldown + safety layer (§6) → submit or hold.
7. Persist decision record (always, including no-ops).
```

### 5.2 Step 0 — Effective competitor set

From the snapshot's top-20 `Offers[]`, **drop**:

| Filter | Field(s) | Rationale |
|---|---|---|
| Our own offer | `SellerId` == ours | Not a competitor |
| Blocklisted sellers | `SellerId` in `sellers` blocklist | Unauthorized/MAP-violating sellers must not drag our price — we exclude them rather than follow them |
| Condition mismatch | `SubCondition` != ours | Used/refurb offers compete in a separate Featured Offer |
| Non-domestic shippers | `ShipsFrom` / domestic flag | Config-per-group; default exclude |
| Feedback below threshold | `SellerFeedbackRating` (% and count) | Weak sellers rarely beat a strong offer at a moderate premium (*estimate-based heuristic*) |
| Shipping too slow | `ShippingTime.maximumHours` > threshold | Post-2025 weighting: slow offers are not real Featured-Offer threats |
| (Optional) non-eligible offers | `IsFeaturedMerchant` == false | **Post-July-2026 caution:** with the eligibility gate removed in the EU this flag's meaning may have shifted; until Phase 0 verification, treat as *soft* signal (score discount), not a drop filter |

Also computed here: presence of **Amazon Retail** (identify by seller name/ID per marketplace — **`TO VERIFY`** current Amazon Retail `SellerId` values for DE/FR/ES; the well-known `ATVPDKIKX0DER` is the **US** one and must not be assumed for EU), the current Buy Box landed price(s) from `Summary.BuyBoxPrices[]`, lowest landed by fulfillment channel from `Summary.LowestPrices[]`, and the runner-up (best competitor landed price in the effective set).

### 5.3 Step 1 — Market-structure branch

```
                            ┌────────────────────────────┐
                            │ Are we suppressed / did     │  yes   ┌──────────────────────────┐
                            │ PRICING_HEALTH fire for us? ├───────►│ Branch D: RESTORE         │
                            └──────────────┬─────────────┘        │ ELIGIBILITY               │
                                           │ no                    └──────────────────────────┘
                            ┌──────────────▼─────────────┐
                            │ Effective competitor set    │  yes   ┌──────────────────────────┐
                            │ empty?                      ├───────►│ Branch A: SOLE SELLER     │
                            └──────────────┬─────────────┘        │ (velocity/target pricing) │
                                           │ no                    └──────────────────────────┘
                            ┌──────────────▼─────────────┐
                            │ Amazon Retail in the set?   │  yes   ┌──────────────────────────┐
                            │                             ├───────►│ Branch B: AMAZON PRESENT  │
                            └──────────────┬─────────────┘        │ (don't chase)             │
                                           │ no                    └──────────────────────────┘
                                           ▼
                            ┌────────────────────────────┐
                            │ Branch C: CONTESTED         │
                            │ (main path)                 │
                            └────────────────────────────┘
```

**Branch A — Sole effective seller.** No competitive anchor exists (also no FOEP: `NO_COMPETING_OFFER`). Run the **velocity controller**: compare trailing 30-day unit velocity to target; above target → raise by one step; below → lower by one step; always within `[strategyFloor, ceilings]`. Watch `PRICING_HEALTH` closely — with no competitors, Amazon's reference-price expectations are the binding constraint. Also used to accelerate sell-through before storage-fee cliffs (aged 181-day surcharge, Oct–Dec peak storage).

**Branch B — Amazon Retail present.** **Never undercut Amazon Retail.** Amazon matches price changes near-instantly and has no floor we can see; undercutting is pure margin destruction, and Amazon's own offer wins the Featured Offer at parity in practice (*consensus observation*). Policy: hold a **wait price** slightly above Amazon's landed price (default +2%, configurable), harvest the share Amazon leaves (stockouts, share caps, regional gaps); match exactly only if the match is ≥ strategyFloor; set a state flag so the *disappearance* of Amazon's offer in a future event triggers immediate re-evaluation under Branch C/A.

**Branch C — Contested listing (main path).** Go to §5.4.

**Branch D — Restore eligibility.** Our offer lost Featured-Offer eligibility (`PRICING_HEALTH`) or the listing is suppressed. The objective flips from "win share" to "become featureable again":

- Use the reference prices carried in the `PRICING_HEALTH` payload (competitive external price, etc.) as the constraint to price back under, clamped to ≥ breakeven.
- If the whole listing is suppressed ("See All Buying Options"), compete for the **top of the All Buying Options list**: lowest qualified landed price + fast delivery ordering (switch to `LOWEST_PRICE` targeting while suppressed).
- If the reference constraint < breakeven → **do not comply**; park at strategyFloor, alert ops with the economics (this is a "product is structurally unprofitable on Amazon" business decision, not a pricing decision).
- Expect recovery 24–48h after a compliant price; keep the SKU in this branch until a subsequent event shows the Featured Offer restored.

### 5.4 Step 2 — Raw target price (Branch C detail)

All arithmetic in landed cents; convert to listing price at the end by subtracting our own shipping (FBA/SFP: 0).

**C-1. If we hold the Buy Box now (`state.holdingBuyBox`): never lower — probe up.**

- On a timer (default every 45 min while holding), raise by `probeStepPct` (default 1%, range 0.5–2%), bounded by:
  - the **runner-up threat price**: the landed price at which the best effective competitor would likely take over — approximate as `runnerUpLanded × (1 + ourAdvantagePremium)` where `ourAdvantagePremium` comes from the adjustment matrix below (0 if runner-up's delivery tier ≥ ours);
  - `fairPricingCeiling` and all §5.5 clamps;
  - never a step ≥ 10% (suppression trigger, §1.5).
- On losing the Buy Box (event shows another featured seller): step back to `probeAnchor` (last known-winning price) immediately, then continue normal targeting. Do **not** dive below the anchor in the same evaluation — one step per event.
- If competitors stock out or leave (set shrinks), probe toward `maxPrice` faster (2× step) — this and the sellout-harvest are where most of the margin upside lives.

**C-2. If we do not hold it: target the winning price, not the bottom.**

Priority order for the anchor:

1. **FOEP** — if enrichment has a fresh (< 24h) `getFeaturedOfferExpectedPriceBatch` result with `resultStatus = VALID_FOEP`, target the FOEP landed price. Sanity-check first (Amazon's own guidance): reject FOEP if < breakeven, or > maxPrice, or deviating > 20% from current Buy Box landed — then fall through to (2).
2. **Buy Box landed price adjusted by the FBA/FBM matrix**:

| Us \ Best effective competitor | FBA/SFP competitor | FBM competitor |
|---|---|---|
| **We are FBA/SFP** | Match, or beat by 1–2 cents | Price **above** by `fbmPremiumPct` (default +3%, range 1–5% — *estimate*; EU note below) |
| **We are FBM** | Price meaningfully below (default −5%) **only if** still ≥ strategyFloor; otherwise don't chase — park at a profitable wait price | Match / beat by 1–2 cents on landed |

  EU note: under the equal-treatment commitments (§1.4) the premium is earned by **delivery outcome**, not the FBA badge. Implement the matrix on delivery tier: tier(offer) = f(Prime flag, `ShippingTime.maximumHours`). SFP counts as the FBA tier. A 0-day-handling FBM offer with same-day promise is *top tier* — treat it as "FBA" in the matrix.

3. **No Buy Box price in Summary** (rare in Branch C): anchor on lowest qualified landed in our fulfillment tier ± matrix offset.

**C-3. `LOWEST_PRICE` strategy SKUs** (per §4.2): target = lowest qualified landed in our fulfillment segment ± configured offset (default: match), same clamps.

**C-4. `VELOCITY` strategy SKUs on contested listings**: velocity controller output, but capped at the C-2 competitive target (competitors act as a ceiling, not an anchor).

**C-5. Undercut-loop guard.** If the same `SellerId` re-undercuts us ≥ N times (default 3) within M minutes (default 60): stop following. Options in order: (a) hold current price and wait (default), or (b) drop once to a configured reset point (e.g. strategyFloor + 50% of the gap to current) and wait for the loop to exhaust — then resume normal targeting after a quiet period (default 6h). Log the loop; surface repeat offenders in ops-console for the blocklist.

**C-6. Wait-for-sellout.** If the price-setting competitor's offer shows near-depletion signals (Amazon does not expose competitor stock directly; heuristic: their offer intermittently drops from the top-20, or listing-level `NumberOfOffers` oscillates) — optionally hold above them and let them sell out rather than race down. Config flag per product group; default off (*heuristic, weak signal*).

### 5.5 Step 3 — Constraint clamps (strict order)

Applied to the raw target, in this exact order; each clamp logs when it binds:

```
1. MAP (hard):            target = max(target, mapCents)          // never advertise below MAP.
                          // Never *follow* MAP-violating competitors — they were excluded in Step 0.
2. Strategy floor:        target = max(target, strategyFloorCents)
3. Business max:          target = min(target, maxPriceCents)
4. Fair-pricing ceiling:  target = min(target, fairPricingCeilingCents)   // §6.2
5. Amazon min/max:        clamp into [amazonMinAllowed, amazonMaxAllowed] // our own backstop values
```

- If the pre-clamp target < strategyFloor: park at strategyFloor **only if** strategyFloor still plausibly wins something (within contention band of the Buy Box landed — *estimate band 1–5%*, §1.2); otherwise exit to a **profitable wait price** (default: min(maxPrice, fairPricingCeiling)) and stop chasing. **Never price below breakeven to win the Buy Box. Ever.**
- If clamps conflict (floor > ceiling, MAP > maxPrice, etc.): **do not price.** Set `automationState = QUARANTINED`, alert ops with the conflicting values. A human resolves it.

### 5.6 Step 4 — Emit only meaningful changes

- **Epsilon:** skip if `|newPrice − currentPrice| < epsilonCents` (default 10 cents or 0.5%, whichever larger). Rationale: every price change we make fires `ANY_OFFER_CHANGED` for *every* seller on the listing including ourselves — sub-epsilon churn feeds everyone's bots and our own queue.
- **Cooldown:** skip if `now − lastSubmissionAt < cooldownSeconds` (default 300 s) unless the event is `PRICING_HEALTH` or a floor breach (safety overrides cooldown).
- **Safety layer** (§6.3) — final check before write.
- **Write path:** `price-writer` submits via `patchListingsItem` (JSON Patch on `purchasable_offer`: `our_price`; also maintain `minimum_seller_allowed_price` / `maximum_seller_allowed_price` as backstops). Bulk sweeps (nightly floor pushes, onboarding, kill-switch reversion) go via `JSON_LISTINGS_FEED` (≤ 25,000 SKUs/feed, ≤ 5 feeds per 5 min) — changed SKUs only.
- **Confirm acceptance:** poll submission status; on `ACCEPTED`, verify with `getListingsItem` (issue-free); price is live on the site in **0–15 min** — reacting faster than propagation just queues churn, which is another reason for the cooldown.
- **On rejection:** log, alert if repeated, do not blind-retry a rejected price.

### 5.7 Concurrency & idempotency rules

- Pub/Sub ordering key `{asin}:{marketplaceId}` serializes evaluations per listing; the engine takes a short Mongo lease (`findOneAndUpdate` on a lock field) as a belt-and-braces guard against redelivery races.
- Evaluations are idempotent: same snapshot + same config ⇒ same decision; the decision record stores `inputsHash` so replays are diffable.
- Stale-event discard: if event `TimeOfOfferChange` ≤ snapshot's, drop it (dedupe already removed exact duplicates).

---

<a name="6-phase-3"></a>
## 6. Phase 3 — Safeguards & rollout

**Gate: all safeguards implemented and exercised (chaos-tested) in shadow mode before the first live cohort.**

### 6.1 Price-error quarantine

Reject (⇒ `QUARANTINED` + alert, no write) any computed price that:

- falls below **absolute breakeven** (this check is in the safety layer and applies even to manually entered prices flowing through the writer);
- deviates more than `maxStepPct` (default 15%) from the current price in a single step;
- derives from null/zero/negative cost inputs or a stale floor;
- follows an **anomalous competitor price** — e.g. best competitor landed < 30% of trailing 7-day median Buy Box landed (the classic €0.01 glitch / hijacker bait). Anomalous offers are dropped from the set and the evaluation re-run without them;
- would violate MAP.

Backstop independent of our code: keep `minimum_seller_allowed_price` / `maximum_seller_allowed_price` set on every listing so Amazon itself rejects a runaway price.

### 6.2 Fair-pricing ceiling (suppression avoidance)

- Maintain `fairPricingCeilingCents` per SKU: default `min(maxPrice, referencePrice × 1.10)` where referencePrice = trailing 30-day median Buy Box landed for the ASIN (from our own snapshots), cross-checked against `getCompetitiveSummary.referencePrices` (**`CompetitivePrice`** — the lowest external-retailer price; this field replaced `CompetitivePriceThreshold` in Sept 2025) when enrichment budget allows.
- Never raise price ≥ 10% in one step (measured dominant suppression trigger, §1.5). The probe logic (§5.4 C-1) is inherently compliant (0.5–2% steps); the quarantine (§6.1) enforces it globally at 15% hard / 10% warn.
- On any `PRICING_HEALTH` or observed suppression: auto-clamp the ceiling to the reference constraint and re-evaluate under Branch D. Remember suppression also silently kills ad delivery — treat it as a P1 incident, not a pricing nuance.

### 6.3 Safety layer (final pre-write check)

A separate, deliberately boring module the writer calls last: breakeven check, MAP check, step-size check, kill-switch check, marketplace sanity (currency matches marketplace), automationState check. It has no strategy knowledge and no exceptions. If it vetoes, the decision record says so.

### 6.4 Kill switches

| Scope | Effect | Actor |
|---|---|---|
| Global | `price-writer` stops submitting; engine keeps evaluating & logging (auto-shadow) | Ops-console big red button; also auto-trips on §7 alert conditions |
| Per marketplace | Same, one marketplace | Ops |
| Per product group / SKU | `automationState = KILLED` | Ops |
| Revert | Bulk feed restoring last human-approved prices (kept per SKU from pre-rollout) | Ops, one click, uses `JSON_LISTINGS_FEED` |

### 6.5 Testing & rollout sequence (in order, each gated)

1. **Unit + property tests** on the solver (bracket edges, VAT rates, monotonicity) and clamp chain (clamp order is a correctness property).
2. **SP-API sandbox** integration tests for every operation.
3. **`VALIDATION_PREVIEW` dry-runs** of `patchListingsItem` against production listings (Amazon validates without applying).
4. **Replay harness:** run the engine over the stored Phase-0 corpus of real notification payloads; assert decision distribution (no floor breaches, quarantine rate < threshold, epsilon-skip rate sane).
5. **Shadow mode (≥ 2 weeks):** full engine on live events; *log intended prices, submit nothing*. Daily diff of intended vs. our actual (manually set) prices and vs. subsequent Buy Box outcomes. Exit criteria: zero would-be floor breaches; < 1% quarantine rate; intended prices judged sane by the pricing owner on a ≥ 100-decision sample.
6. **Cohort 1 live (~5% of SKUs):** stable, mid-velocity, comfortable-margin SKUs across all three marketplaces; no top-20-revenue SKUs, no thin-margin SKUs. Run ≥ 2 weeks. Watch §7 KPIs vs. the Phase-0 baseline.
7. **Cohort 2 (~25%)** → **Cohort 3 (long tail)** → **Cohort 4 (top-revenue SKUs, last)**. Each expansion requires: no unresolved quarantines, KPIs ≥ baseline, ops sign-off.
8. `MANUAL_ONLY` and `EXCLUDED` SKUs remain outside automation indefinitely; the data-audit report (§3.3) tracks the excluded population toward zero.

### 6.6 Audit log

Every evaluation — including no-ops and vetoes — appends one `decisions` document: trigger (type + notification id + `TimeOfOfferChange`), full effective-competitor snapshot (post-filter, with drop reasons), branch taken, strategy, raw target, every clamp with bind/no-bind, safety-layer verdict, before/after price, submission id + acceptance status, engine version + config hash. Retention ≥ 24 months. This is what lets us debug a price war, prove MAP compliance to a brand, and demonstrate unilateral conduct (§6.7).

### 6.7 Compliance constraints

- **Unilateral conduct only.** All pricing logic uses our own data plus publicly observable prices from Amazon's APIs. No coordination signals, no honoring competitor "signaling" patterns, no data exchange with other sellers. Algorithmic-collusion scrutiny (EU + national competition authorities) is growing; the price-up probe must remain a function of *our* state and *public* prices only. Legal reviews this section.
- **MAP:** we clamp to MAP and exclude violators; we never advertise below MAP even transiently.
- The audit log (§6.6) is the evidence base for both.

---

<a name="7-monitoring"></a>
## 7. Monitoring, alerting and KPIs

**Dashboards (Cloud Monitoring + a Mongo-backed ops view):**

| Metric | Source | Alert threshold (default) |
|---|---|---|
| Buy Box share per SKU/group/marketplace | Business Reports import + snapshot-derived `IsBuyBoxWinner` | −10 pp vs 7-day baseline → warn; −25 pp → page + consider kill switch |
| Floor-hit rate (decisions parked at floor) | decisions | > 10% of decisions/day → review pricing viability |
| Suppression / PRICING_HEALTH events | notifications | Any → P1 ticket (ads die within ~12h) |
| Quarantine queue depth & age | skuPricing | > 20 open or > 24h old → escalate |
| Event lag (notification → decision) | pipeline timestamps | p95 > 5 min → investigate |
| Submission rejection rate | price-writer | > 2% → investigate |
| Undercut loops detected | decisions | Repeat seller → blocklist review |
| Average realized margin per SKU | ERP settlement data joined to decisions | Downward drift vs pre-rollout → strategy review |
| Fee-refresh freshness / floor staleness | floor-service | Any stale-floor LIVE SKU → auto-exclude + alert (should be impossible; alarm = bug) |

**Auto-trip conditions for the global kill switch:** > N floor-parked decisions in an hour (default 50), any breakeven-breach attempt reaching the safety layer, suppression events on > K SKUs in an hour (default 5), submission error rate > 10%.

**Business KPIs for the rollout review:** Buy Box share, units/day, realized net margin per unit, revenue — cohort vs. control (not-yet-migrated) SKUs.

---

<a name="8-appendices"></a>
## 8. Appendices

### 8.1 SP-API surface used by this system

Rates are documented defaults **per seller-app pair**; record observed values from `x-amzn-RateLimit-Limit` in Phase 0 (they change — re-verify at implementation).

| Operation | Use in this system | Documented rate |
|---|---|---|
| `ANY_OFFER_CHANGED` notification | Primary trigger; payload usually sufficient to reprice without follow-up calls | n/a (push) |
| `PRICING_HEALTH` notification | Eligibility-loss trigger + reference prices for Branch D | n/a (push) |
| `FEE_PROMOTION` notification | Floor recompute trigger | n/a (push) |
| `getFeaturedOfferExpectedPriceBatch` (v2022-05-01) | Target-price anchor, ≤ 40 SKUs/call; `resultStatus` ∈ VALID_FOEP / NO_COMPETING_OFFER / OFFER_NOT_ELIGIBLE / … | Low — enrichment only |
| `getCompetitiveSummary` (v2022-05-01) | Reference prices incl. `CompetitivePrice` (replaced `CompetitivePriceThreshold`, Sept 2025); ≤ 20 ASINs | ~0.033 rps — strictly budgeted |
| `getItemOffersBatch` (v0) | Backfill poller only, ≤ 20 requests/POST | 0.5 rps (deliberately low — Amazon pushes event-driven) |
| `getItemOffers` / `getListingOffers` (v0) | Ad-hoc single-ASIN inspection (ops-console) | 5 rps / burst 10 |
| `getPricing` / `getCompetitivePricing` (v0) | Onboarding reconciliation | 10 rps / burst 20 |
| `getMyFeesEstimate` (Product Fees API) | Floor inputs per SKU | per docs — batch nightly |
| `patchListingsItem` (Listings Items API) | Real-time price writes (`purchasable_offer`: `our_price`, `minimum/maximum_seller_allowed_price`); supports `mode=VALIDATION_PREVIEW` | ~5 rps |
| `JSON_LISTINGS_FEED` (Feeds API) | Bulk writes: onboarding, nightly floor sweeps, kill-switch revert | ≤ 25,000 SKUs/feed; 5 feeds / 5 min |
| `createDestination` / `createSubscription` (Notifications API) | One-time setup + health checks | per docs |

### 8.2 `ANY_OFFER_CHANGED` payload fields the engine consumes

- `OfferChangeTrigger`: ASIN, marketplace, item condition, `TimeOfOfferChange`, trigger type ∈ **Internal / External / FeaturedOffer** (External = an off-Amazon price changed — relevant to fair-pricing ceiling).
- `Summary`: `NumberOfOffers[]`, `TotalBuyBoxEligibleOffers` (semantics **`TO VERIFY`** post-rank-only), `LowestPrices[]` and `BuyBoxPrices[]` (each per condition × fulfillment channel, with `LandedPrice = ListingPrice + Shipping`), `ListPrice`, `MinimumAdvertisedPrice`, `SalesRankings[]`, `CompetitivePriceThreshold` (being superseded by `CompetitivePrice` in the newer API — treat as legacy).
- `Offers[]` (top 20): `SellerId`, `ListingPrice`, `Shipping` (→ landed), `IsBuyBoxWinner`, `IsFulfilledByAmazon`, `IsFeaturedMerchant`, `SellerFeedbackRating` (% + count), `ShippingTime` (min/max hours, availability), `PrimeInformation` (SFP detection), `ShipsFrom`/domestic flags, `SubCondition`.
- Limits to remember: only ASINs where **we hold an offer**, only on changes, only the **top 20** offers — hence the backfill poller.

### 8.3 Glossary

| Term | Meaning |
|---|---|
| ASIN | Amazon's product identifier; one listing, many sellers |
| Buy Box / Featured Offer | The offer behind Add-to-Cart / Buy-Now; the thing this engine competes for |
| Landed price | Item price + shipping — the only price this engine ever compares |
| FBA / FBM / SFP | Fulfilled by Amazon / by merchant / Seller-Fulfilled Prime (merchant ships, Prime badge) |
| FOEP | Featured Offer Expected Price — Amazon's own estimate of the price at which our offer would be expected to win |
| MAP | Minimum advertised price (contractual, brand-imposed) |
| ODR / OTD | Order defect rate / on-time delivery rate (account health) |
| Suppression | No offer featured; "See All Buying Options" shown |
| Breakeven floor / strategy floor | Solved 0%-margin price / breakeven + minimum margin |
| Shadow mode | Engine runs fully on live events but submits nothing |

### 8.4 Source basis & freshness

Compiled from an internal knowledge base (snapshot **August 2026**: Amazon SP-API documentation, Amazon's Price Adjustment Automation Workflows Guide, Marketplace Fair Pricing Policy, EU Commission Case AT.40703 commitments, Georgetown suppression study, and repricer-vendor practice — Feedvisor, Seller Snap, Informed.co, Repricer.com, BQool, Aura), refreshed on 2026-08-01 with a web check confirming: (a) the **rank-only Featured Offer went live in EU/UK marketplaces July 20, 2026** — performance metrics are now weighted ranking factors, not gates; (b) **EU referral/FBA fee reductions effective Dec 15, 2025 / Jan 5, 2026** (fee schedules must be pulled live, never hard-coded). Amazon has never published the ranking formula; all weights/premiums herein are labelled estimates. Re-run the freshness check whenever this spec is revised.

---

<a name="9-decisions-to-confirm"></a>
## 9. Decisions to confirm (business sign-off required before Phase 2 build)

Every tunable the business must choose. Defaults are proposed and safe-ish, not sacred.

| # | Decision | Proposed default | Owner |
|---|---|---|---|
| 1 | Minimum net margin (strategy floor) per product group | 12% of net (ex-VAT) revenue | Finance |
| 2 | Strategy per product group (BUY_BOX / LOWEST_PRICE / VELOCITY / MANUAL_ONLY) | BUY_BOX for contested; VELOCITY for sole-seller private label; MANUAL_ONLY for top-20-revenue SKUs until Cohort 4 | Commercial |
| 3 | FBM premium when we're FBA vs FBM competitor (`fbmPremiumPct`) | +3% (range 1–5; delivery-tier based per §5.4 EU note) | Commercial |
| 4 | We-FBM vs FBA-competitor undercut / don't-chase threshold | −5% or park at wait price | Commercial |
| 5 | Amazon-Retail wait-price premium | +2% above Amazon's landed | Commercial |
| 6 | Probe step & interval while holding Buy Box | 1% every 45 min | Commercial |
| 7 | Change epsilon | max(10 cents, 0.5%) | Engineering |
| 8 | Per-SKU cooldown | 300 s | Engineering |
| 9 | Undercut-loop guard N/M and quiet period | 3 undercuts / 60 min; 6 h quiet; response = hold | Commercial |
| 10 | Competitor filters: min feedback %, min count, max shipping hours, domestic-only | 90%, 50 ratings, 96 h, domestic-only ON | Commercial |
| 11 | Fair-pricing ceiling formula | min(maxPrice, 30-day median Buy Box landed × 1.10) | Commercial + Legal |
| 12 | Quarantine max single-step deviation | 15% hard (warn 10%) | Engineering |
| 13 | Floor staleness window | 7 days | Finance |
| 14 | Returns allowance per category; ad cost in floor? | Category table; ads excluded from floor (tracked as KPI) v1 | Finance |
| 15 | Notification aggregation window | none (measure first, §3.2) | Engineering |
| 16 | Velocity strategy: target 30-day velocity per SKU set | Per-SKU from demand plan | Commercial |
| 17 | Wait-for-sellout feature on? | Off (weak signal) | Commercial |
| 18 | Rollout cohort composition & KPI thresholds | §6.5 / §7 defaults | All |
| 19 | Blocklist governance (who adds/removes sellers) | Brand-protection owner, logged | Commercial + Legal |
| 20 | VAT basis of referral-fee calculation confirmed per marketplace | **`TO VERIFY`** with finance | Finance |

---
*End of specification. Implementation questions: annotate this document; material changes to Amazon behavior discovered during build should be fed back so the spec (and its underlying knowledge base) can be updated.*

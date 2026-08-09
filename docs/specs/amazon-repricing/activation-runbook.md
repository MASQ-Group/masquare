# Amazon Repricing — shadow-mode activation runbook

How to take the module from "built" to "running in shadow on a live marketplace", and the gated
path from shadow to live. The engine is **shadow-complete**: it evaluates live events and logs the
intended price but **submits nothing** until a SKU is `LIVE` **and** the live-writes master switch is
on (both off by default). Nothing here risks a real price change on its own.

Spec references: ingest §2.2–2.3, engine §5, safeguards §6, rollout §6.5, monitoring §7.

## 0. Prerequisites (one-time, needs the live Amazon/AWS account)

- **SP-API app roles:** Product Pricing, Product Listing / Listings Items, and Notifications. The app
  "MASQ Group Platform" is set up; confirm the roles are granted for each marketplace.
- **AWS SQS bridge** for SP-API notifications. Live queue already provisioned:
  `arn:aws:sqs:eu-north-1:631245465175:masquare-spapi-notifications`
  (account 631245465175, region eu-north-1; SP-API sender account 437568002678).
- **Per-SKU data readiness (§3.3):** landed COGS, SKU↔ASIN↔marketplace mapping, MAP, fulfilment. The
  onboarding step reports the gap; SKUs without a computable floor stay `EXCLUDED` and are never priced.

## 1. Environment variables (API service, production)

| Var | Purpose | Default if unset |
|---|---|---|
| `AMZ_SQS_QUEUE_URL` | The SQS queue the SP-API notifications land in. **Set this to start the poller** — it is dormant while unset. | poller off |
| `AMZ_SQS_REGION` | Queue region (e.g. `eu-north-1`). | — |
| `AMZ_SQS_ACCESS_KEY_ID` / `AMZ_SQS_SECRET_ACCESS_KEY` | IAM creds to read/delete from the queue. | — |
| `AMZ_REPRICING_LIVE_WRITES` | Env master allowing real price writes. Keep **false** for shadow. | false (shadow) |
| `AMZ_REPRICING_KILL_SWITCH` | Env kill switch — forces SKIP regardless of DB state. Leave **unset** normally. | off |

There is also a **DB-backed** kill switch and live-writes toggle (ops console, §6.4). A real write
requires: SKU `automationState = LIVE` **and** DB live-writes ON **and** env `AMZ_REPRICING_LIVE_WRITES=true`
**and** neither kill switch engaged. In shadow you set none of these.

## 2. Bring up shadow mode (per marketplace)

All ops endpoints are admin-only, under `/api/amazon-repricing`.

1. **Register SP-API notifications → SQS** (grantless): `POST /api/integrations/:id/spapi-notifications/setup` with `{ "sqsArn": "arn:aws:sqs:eu-north-1:631245465175:masquare-spapi-notifications" }`. Subscribes ANY_OFFER_CHANGED, PRICING_HEALTH, FEE_PROMOTION.
2. **Set `AMZ_SQS_*`** env and (re)start the API → the SQS poller begins draining events.
3. **Onboard SKUs:** `POST /api/amazon-repricing/onboard` (or the "Onboard SKUs" button). Seeds `RepricingSkuPricing` from matched Amazon listings; rows start `EXCLUDED` until floors compute.
4. **Compute floors:** `POST /api/amazon-repricing/floors/recompute` (or "Recompute floors"). Makes live `getMyFeesEstimate` calls; SKUs with a valid floor promote `EXCLUDED → SHADOW`.
5. **Confirm safety is OFF:** the ops page (`/repricing`) should show the kill switch released and live-writes OFF. This is the shadow default.

Events now flow: SQS → parse → dedupe (NotificationId) → stale-discard → persist snapshot →
**30s per-ASIN debounce** → evaluate → **decision logged, nothing submitted**.

## 3. What to watch during shadow (≥ 2 weeks, §6.5)

On `/repricing`:
- **Readiness row** — counts by state. Goal: `EXCLUDED` trending to zero, most SKUs `SHADOW`.
- **Decision audit** — search by SKU / outcome. Exit criteria: **zero would-be floor breaches**
  (there should be none — the clamp chain forbids it), a **sane intended-price distribution** on a
  ≥ 100-decision sample (pricing owner's judgement), sane epsilon-skip rate.
- **Quarantine queue** — should be **< 1%** of SKUs and never `> 20 open` or `> 24h old` (it flags
  "escalate" past that). Each quarantine is a conflicting-bounds SKU; fix the values, then Resolve.
- Daily: diff intended prices vs our actual (manually set) prices and vs subsequent Buy Box outcomes.

Active safeguards in shadow (all already enforced in the logged decisions): breakeven / strategy-floor
/ MAP clamps, §6.1 anomalous-competitor guard, §5.4 C-5 undercut-loop guard, §6.2 fair-pricing ceiling,
and price-error quarantine (§5.5).

## 4. Shadow → live (gated cohorts, §6.5 — do NOT skip)

Only after the shadow exit criteria hold:
1. **VALIDATION_PREVIEW dry-runs** of `patchListingsItem` against real listings (Amazon validates,
   applies nothing) — verify the `purchasable_offer` attribute shape end to end. *(This is the one
   `TO VERIFY` before any real write.)*
2. **Cohort 1 (~5% of SKUs):** stable, mid-velocity, comfortable-margin SKUs; no top-20-revenue, no
   thin-margin. Flip those rows to `LIVE`, turn on DB live-writes, set `AMZ_REPRICING_LIVE_WRITES=true`.
   Run ≥ 2 weeks; watch §7 KPIs vs the Phase-0 baseline.
3. **Cohort 2 (~25%) → Cohort 3 (long tail) → Cohort 4 (top-revenue, last).** Each expansion needs:
   no unresolved quarantines, KPIs ≥ baseline, ops sign-off.

`MANUAL_ONLY` and `EXCLUDED` SKUs stay outside automation.

## 5. Stop / revert

- **Global stop:** the ops-console big red button (DB kill switch) or `AMZ_REPRICING_KILL_SWITCH` env
  → the writer submits nothing; the engine keeps evaluating and logging (auto-shadow).
- **Per SKU:** set `automationState = KILLED`.
- **Revert prices:** bulk feed restoring the last human-approved prices (kept per SKU pre-rollout).

## Still-external gaps (won't function until wired)

- **FOEP enrichment** (`getFeaturedOfferExpectedPriceBatch`) and **acceptance-confirm**
  (`getListingsItem`) — dormant stubs; need the live SP-API calls + rate budgeting (§8.1).
- **Velocity strategy** (Branch A / §5.4 C-4) — needs a per-SKU *target 30-day unit velocity* field
  and a sales-velocity rollup scoped to the marketplace. `VELOCITY` SKUs hold (no signal) until then.
- The §6.2 PRICING_HEALTH auto-clamp-to-reference cross-check ties into enrichment / Branch D.

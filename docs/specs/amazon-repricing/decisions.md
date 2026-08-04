# Amazon Repricing — Decisions Log (living)

Tracks the spec §9 "Decisions to confirm" toward sign-off, plus the `TO VERIFY` markers the
build must not resolve by guesswork. Update the **Status** column as owners confirm values.
Source: [`spec-v1-source.md`](./spec-v1-source.md) §9 · [`phase-0-findings.md`](./phase-0-findings.md) §F.

## §9 tunables

| # | Decision | Working default (in code) | Owner | Status |
|---|----------|---------------------------|-------|--------|
| 1 | Min net margin (strategy floor) | 12% ex-VAT (`REPRICING_DEFAULTS.minMarginPct`) | Finance | **Pending** |
| 2 | Strategy per product group | BUY_BOX / VELOCITY / MANUAL_ONLY | Commercial | Pending |
| 3 | FBM premium (we FBA vs FBM comp) | +3% | Commercial | Pending |
| 4 | We-FBM vs FBA comp | −5% / wait | Commercial | Pending |
| 5 | Amazon-Retail wait premium | +2% | Commercial | Pending |
| 6 | Probe step / interval | 1% / 45 min | Commercial | Pending |
| 7 | Epsilon | max(10c, 0.5%) | Engineering | **Adopted** |
| 8 | Cooldown | 300 s | Engineering | **Adopted** |
| 9 | Undercut-loop N/M/quiet | 3 / 60 min / 6 h, hold | Commercial | Pending |
| 10 | Competitor filters | 90% / 50 / 96 h / domestic-only | Commercial | Pending |
| 11 | Fair-pricing ceiling | min(max, 30d-median BB ×1.10) | Commercial + Legal | Pending |
| 12 | Quarantine max step | 15% hard / 10% warn | Engineering | **Adopted** |
| 13 | Floor staleness | 7 days | Finance | **Pending** |
| 14 | Returns allowance / ad cost in floor | category table / ads excluded v1 | Finance | Pending (needs returns-rate source) |
| 15 | Notification aggregation | none (measure first) | Engineering | Deferred to Phase 2 exec |
| 16 | Velocity targets | per-SKU from demand plan | Commercial | Pending |
| 17 | Wait-for-sellout | off | Commercial | Adopted (off) |
| 18 | Cohort composition / KPIs | §6.5 / §7 | All | Pending |
| 19 | Blocklist governance | brand-protection owner | Commercial + Legal | Pending |
| 20 | **Referral-fee VAT basis** | gross (VAT-inclusive), configurable | Finance | **BLOCKING — pending** |

## Open `TO VERIFY` markers (must not be guessed — spec ground rule #3)

| Marker | Where | Status |
|--------|-------|--------|
| Referral-fee VAT basis per marketplace (§9-#20) | `floor-solver.ts` `referralFeeBasis` default `'gross'` | **Blocking** — solver correctness depends on it |
| Current EU referral **bracket structure** per category | `config/referral-schedule.ts` (flat 15% placeholder) | Blocking for tiered categories; flat default safe-ish |
| Reduced VAT rates per product tax code (DE/FR/ES) | `floor/vat.service.ts` (standard rate only; D-2 gap) | Open — conservative (floor too high) until sourced |
| SP-API **Product Fees** role on our app (§3.1) | `floor.service.ts` `refreshFees()` throws | Blocking for live floors — fees must be seeded until granted |
| SP-API Pricing / Notifications roles, sandbox access | Phase 0 checklist | Pending (ops/live access) |
| `IsFeaturedMerchant` / `TotalBuyBoxEligibleOffers` post-rank-only semantics | Phase 2/3 (competitor filter) | Pending live payloads |
| Amazon Retail EU `SellerId` for DE/FR/ES | Phase 3 Branch B | Pending (US `ATVPDKIKX0DER` must NOT be assumed for EU) |

## Deviations from spec (accepted at Phase 0, see findings §E)

D-1 monolith+Postgres work-queue (not GCP microservices) · D-2 no shared VAT engine (thin adapter)
· D-3 integer-cents money type at module boundary · D-4 `@masquare/ui` not shadcn · D-5 token-bucket
rate limiter (Phase 4) · D-6 naming (maSquare).

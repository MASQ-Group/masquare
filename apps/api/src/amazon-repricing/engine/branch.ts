import { Branch, CompetitorSet, MarketSnapshot } from './types';

// Step 1 — market-structure branch (spec §5.3). Evaluated in strict priority order: a suppressed
// or eligibility-lost listing (D) overrides everything; then sole-seller (A); then Amazon-present
// (B); else the contested main path (C). PURE.
export function classifyBranch(snapshot: MarketSnapshot, set: CompetitorSet): Branch {
  // D — we're suppressed or PRICING_HEALTH fired: objective flips to "become featureable again".
  if (snapshot.suppressed || snapshot.pricingHealthFired) return 'D_RESTORE';
  // A — no effective competitive anchor exists: run the velocity/target controller.
  if (set.effective.length === 0) return 'A_SOLE';
  // B — Amazon Retail is in the set: never chase it; hold a wait price above.
  if (set.amazonRetailPresent) return 'B_AMAZON';
  // C — contested listing: the main repricing path.
  return 'C_CONTESTED';
}

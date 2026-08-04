// Engine-wide defaults — the spec §9 "Decisions to confirm" tunables. Engineering-owned rows
// are adopted as-is; finance/commercial/legal rows carry their proposed default here but MUST be
// confirmed by their owners before Phase 2 (see docs/specs/amazon-repricing/decisions.md).
// Per-SKU overrides live on RepricingSkuPricing.params.* and win over these.

export const REPRICING_DEFAULTS = {
  /** §9-#1 Minimum net margin for the strategy floor, as a fraction of net (ex-VAT) revenue. FINANCE. */
  minMarginPct: 0.12,
  /** §9-#13 Floor staleness window. Past this the SKU auto-excludes from automation. FINANCE. */
  floorStalenessDays: 7,
  /** §9-#7 Change epsilon — skip sub-threshold churn. max(10c, 0.5%). ENGINEERING. */
  epsilonCents: 10,
  epsilonPct: 0.005,
  /** §9-#8 Per-SKU cooldown between submissions. ENGINEERING. */
  cooldownSeconds: 300,
  /** §9-#12 Quarantine single-step deviation: hard reject / warn. ENGINEERING. */
  maxStepPctHard: 0.15,
  maxStepPctWarn: 0.1,
  /** §9-#6 Buy-Box hold probe. COMMERCIAL. */
  probeStepPct: 0.01,
  probeIntervalMinutes: 45,
  /** §9-#3 FBM premium when we are FBA vs an FBM competitor (delivery-tier based per §5.4). COMMERCIAL. */
  fbmPremiumPct: 0.03,
  /** §9-#4 How far below a better-delivery competitor we go to compete. COMMERCIAL. */
  fbmUndercutPct: 0.05,
  /** When matching a same-tier competitor, shave this many cents (1–2c). ENGINEERING. */
  beatByCents: 2,
  /** Hard cap on a single UPWARD step — never ≥ 10% (suppression trigger, §1.5). ENGINEERING. */
  maxUpStepPct: 0.1,
  /** §9-#5 Amazon-Retail wait-price premium above Amazon's landed. COMMERCIAL. */
  amazonRetailWaitPremiumPct: 0.02,
  /** §9-#10 Competitor-set filters. COMMERCIAL. */
  minFeedbackPct: 0.9,
  minFeedbackCount: 50,
  maxShippingHours: 96,
  domesticOnly: true,
  /** §9-#9 Undercut-loop guard. COMMERCIAL. */
  undercutLoopCount: 3,
  undercutLoopWindowMinutes: 60,
  undercutLoopQuietHours: 6,
  /** §9-#11 Fair-pricing ceiling: min(maxPrice, 30-day median Buy Box landed × this). COMMERCIAL + LEGAL. */
  fairPricingCeilingMultiplier: 1.1,
  /** §6.1 Anomalous-competitor guard: drop offers below this fraction of the 7-day median Buy Box. */
  anomalousCompetitorFraction: 0.3,
} as const;

/** Amazon marketplace id → ISO-2 country code, for VAT resolution against Country. Matches
 *  connectors.ts getMarketplace(); IDs verified in Phase 0 findings §B. */
export const MARKETPLACE_TO_ISO: Record<string, string> = {
  A1PA6795UKMFR9: 'DE', // amazon.de
  A13V1IB3VIYZZH: 'FR', // amazon.fr
  A1RKKUPIHCS9HS: 'ES', // amazon.es
};

/** ISO-2 country code → Amazon marketplace id (inverse of MARKETPLACE_TO_ISO). Used to derive a
 *  listing's marketplace id from its integration's country during onboarding. */
export const ISO_TO_MARKETPLACE: Record<string, string> = Object.fromEntries(
  Object.entries(MARKETPLACE_TO_ISO).map(([mkt, iso]) => [iso, mkt]),
);

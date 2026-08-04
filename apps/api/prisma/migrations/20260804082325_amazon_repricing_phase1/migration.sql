-- CreateTable
CREATE TABLE "repricing_sku_pricing" (
    "id" UUID NOT NULL,
    "company_id" UUID,
    "product_id" UUID,
    "sku" TEXT NOT NULL,
    "asin" TEXT,
    "marketplace_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "fulfillment" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'BUY_BOX',
    "automation_state" TEXT NOT NULL DEFAULT 'EXCLUDED',
    "exclusion_reason" TEXT,
    "breakeven_cents" INTEGER,
    "strategy_floor_cents" INTEGER,
    "floors_computed_at" TIMESTAMP(3),
    "floor_stale_after" TIMESTAMP(3),
    "floor_inputs_hash" TEXT,
    "max_price_cents" INTEGER,
    "map_cents" INTEGER,
    "fair_pricing_ceiling_cents" INTEGER,
    "amazon_min_allowed_cents" INTEGER,
    "amazon_max_allowed_cents" INTEGER,
    "epsilon_cents" INTEGER,
    "cooldown_seconds" INTEGER,
    "probe_step_pct" DECIMAL(6,4),
    "probe_interval_minutes" INTEGER,
    "fbm_premium_pct" DECIMAL(6,4),
    "min_margin_pct" DECIMAL(6,4),
    "current_price_cents" INTEGER,
    "last_submitted_price_cents" INTEGER,
    "last_submission_at" TIMESTAMP(3),
    "last_submission_status" TEXT,
    "holding_buy_box" BOOLEAN NOT NULL DEFAULT false,
    "hold_since" TIMESTAMP(3),
    "probe_anchor_cents" INTEGER,
    "undercut_loop" JSONB,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "last_event_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "repricing_sku_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repricing_offer_snapshot" (
    "id" UUID NOT NULL,
    "asin" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "time_of_offer_change" TIMESTAMP(3) NOT NULL,
    "summary" JSONB NOT NULL,
    "offers" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repricing_offer_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repricing_decision" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "asin" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger_type" TEXT NOT NULL,
    "notification_id" TEXT,
    "time_of_offer_change" TIMESTAMP(3),
    "branch" TEXT,
    "strategy" TEXT,
    "outcome" TEXT NOT NULL,
    "raw_target_cents" INTEGER,
    "final_price_cents" INTEGER,
    "before_price_cents" INTEGER,
    "clamps" JSONB,
    "competitor_set" JSONB,
    "safety_verdict" JSONB,
    "submission_id" TEXT,
    "submission_status" TEXT,
    "engine_version" TEXT,
    "config_hash" TEXT,
    "inputs_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repricing_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repricing_blocked_seller" (
    "id" UUID NOT NULL,
    "marketplace_id" TEXT,
    "seller_id" TEXT NOT NULL,
    "seller_name" TEXT,
    "reason" TEXT,
    "brand" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "observed_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "repricing_blocked_seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repricing_fee_estimate" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "asin" TEXT,
    "marketplace_id" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "referral_fee_cents" INTEGER,
    "fba_fulfillment_fee_cents" INTEGER,
    "closing_fee_cents" INTEGER,
    "total_fee_cents" INTEGER,
    "raw" JSONB,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repricing_fee_estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repricing_notif_dedupe" (
    "id" UUID NOT NULL,
    "notification_id" TEXT NOT NULL,
    "notification_type" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repricing_notif_dedupe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repricing_sku_pricing_asin_marketplace_id_idx" ON "repricing_sku_pricing"("asin", "marketplace_id");

-- CreateIndex
CREATE INDEX "repricing_sku_pricing_automation_state_idx" ON "repricing_sku_pricing"("automation_state");

-- CreateIndex
CREATE INDEX "repricing_sku_pricing_floor_stale_after_idx" ON "repricing_sku_pricing"("floor_stale_after");

-- CreateIndex
CREATE INDEX "repricing_sku_pricing_product_id_idx" ON "repricing_sku_pricing"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "repricing_sku_pricing_marketplace_id_sku_key" ON "repricing_sku_pricing"("marketplace_id", "sku");

-- CreateIndex
CREATE INDEX "repricing_offer_snapshot_marketplace_id_idx" ON "repricing_offer_snapshot"("marketplace_id");

-- CreateIndex
CREATE UNIQUE INDEX "repricing_offer_snapshot_asin_marketplace_id_key" ON "repricing_offer_snapshot"("asin", "marketplace_id");

-- CreateIndex
CREATE INDEX "repricing_decision_sku_marketplace_id_at_idx" ON "repricing_decision"("sku", "marketplace_id", "at");

-- CreateIndex
CREATE INDEX "repricing_decision_outcome_idx" ON "repricing_decision"("outcome");

-- CreateIndex
CREATE INDEX "repricing_blocked_seller_seller_id_idx" ON "repricing_blocked_seller"("seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "repricing_blocked_seller_marketplace_id_seller_id_key" ON "repricing_blocked_seller"("marketplace_id", "seller_id");

-- CreateIndex
CREATE INDEX "repricing_fee_estimate_sku_marketplace_id_fetched_at_idx" ON "repricing_fee_estimate"("sku", "marketplace_id", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "repricing_notif_dedupe_notification_id_key" ON "repricing_notif_dedupe"("notification_id");

-- CreateIndex
CREATE INDEX "repricing_notif_dedupe_expires_at_idx" ON "repricing_notif_dedupe"("expires_at");

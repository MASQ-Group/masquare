-- Repricing analytics, phase 1 and 2: what a price did, what the market looked like, and the daily
-- summary both roll up into. All three start empty; history begins when recording begins.
CREATE TABLE "channel_price_history" (
    "id" UUID NOT NULL,
    "company_id" UUID,
    "integration_id" UUID,
    "marketplace_id" TEXT NOT NULL DEFAULT '',
    "channel_sku" TEXT NOT NULL,
    "product_id" UUID,
    "price_cents" INTEGER NOT NULL,
    "previous_price_cents" INTEGER,
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "decision_id" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_price_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "channel_price_history_channel_sku_marketplace_id_at_idx" ON "channel_price_history"("channel_sku", "marketplace_id", "at");
CREATE INDEX "channel_price_history_product_id_at_idx" ON "channel_price_history"("product_id", "at");
CREATE INDEX "channel_price_history_at_idx" ON "channel_price_history"("at");

CREATE TABLE "repricing_market_sample" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "asin" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "our_price_cents" INTEGER,
    "buy_box_landed_cents" INTEGER,
    "we_hold_buy_box" BOOLEAN NOT NULL DEFAULT false,
    "competitor_count" INTEGER NOT NULL DEFAULT 0,
    "lowest_competitor_cents" INTEGER,
    "floor_cents" INTEGER,
    "decision_id" UUID,
    CONSTRAINT "repricing_market_sample_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "repricing_market_sample_sku_marketplace_id_at_idx" ON "repricing_market_sample"("sku", "marketplace_id", "at");
CREATE INDEX "repricing_market_sample_at_idx" ON "repricing_market_sample"("at");

CREATE TABLE "repricing_daily_stat" (
    "id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "sku" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "product_id" UUID,
    "evaluations" INTEGER NOT NULL DEFAULT 0,
    "priced" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "quarantined" INTEGER NOT NULL DEFAULT 0,
    "vetoed" INTEGER NOT NULL DEFAULT 0,
    "price_changes" INTEGER NOT NULL DEFAULT 0,
    "price_open_cents" INTEGER,
    "price_close_cents" INTEGER,
    "price_min_cents" INTEGER,
    "price_max_cents" INTEGER,
    "buy_box_samples" INTEGER NOT NULL DEFAULT 0,
    "buy_box_won" INTEGER NOT NULL DEFAULT 0,
    "at_floor_samples" INTEGER NOT NULL DEFAULT 0,
    "units_sold" INTEGER NOT NULL DEFAULT 0,
    "revenue_cents" INTEGER NOT NULL DEFAULT 0,
    "profit_cents" INTEGER,
    "fee_basis" TEXT,
    "units_after_change" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repricing_daily_stat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "repricing_daily_stat_day_sku_marketplace_id_key" ON "repricing_daily_stat"("day", "sku", "marketplace_id");
CREATE INDEX "repricing_daily_stat_sku_marketplace_id_day_idx" ON "repricing_daily_stat"("sku", "marketplace_id", "day");
CREATE INDEX "repricing_daily_stat_day_idx" ON "repricing_daily_stat"("day");

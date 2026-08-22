-- Named bundles of the repricing parameters that already existed per SKU.
--
-- Referenced rather than copied: a SKU points at a preset and values resolve at read time, so
-- editing a preset moves every SKU on it. The per-SKU override columns remain for exceptions and
-- win over the preset.
CREATE TABLE "repricing_strategy_preset" (
  "id"                     UUID PRIMARY KEY,
  "name"                   TEXT NOT NULL UNIQUE,
  "description"            TEXT,
  "is_system"              BOOLEAN NOT NULL DEFAULT false,
  "sort_order"             INTEGER NOT NULL DEFAULT 0,
  "strategy"               TEXT NOT NULL DEFAULT 'BUY_BOX',
  "min_margin_pct"         DECIMAL(6,4) NOT NULL,
  "probe_step_pct"         DECIMAL(6,4),
  "probe_interval_minutes" INTEGER,
  "fbm_premium_pct"        DECIMAL(6,4),
  "epsilon_cents"          INTEGER,
  "requires_loaded_floor"  BOOLEAN NOT NULL DEFAULT false,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT now(),
  "deleted_at"             TIMESTAMP(3)
);

ALTER TABLE "repricing_sku_pricing"
  ADD COLUMN "preset_id" UUID REFERENCES "repricing_strategy_preset"("id") ON DELETE SET NULL;
CREATE INDEX "repricing_sku_pricing_preset_id_idx" ON "repricing_sku_pricing"("preset_id");

-- The six presets. Margins are percentages, matching min_margin_pct's per-SKU counterpart.
--
-- requires_loaded_floor is set on the aggressive ones: below roughly 8% a floor that omits storage
-- or advertising stops being merely optimistic and starts reporting a loss as a profit.
INSERT INTO "repricing_strategy_preset"
  ("id","name","description","is_system","sort_order","strategy","min_margin_pct","probe_step_pct","probe_interval_minutes","fbm_premium_pct","epsilon_cents","requires_loaded_floor")
VALUES
  (gen_random_uuid(),'Protect margin','Holds a high floor and will not chase a competitor down. For exclusive lines and strong brands.',true,10,'BUY_BOX',20.0000,0.0050,90,0.0400,25,false),
  (gen_random_uuid(),'Balanced','The default. Competes for the Buy Box while keeping a 12% margin.',true,20,'BUY_BOX',12.0000,NULL,NULL,NULL,NULL,false),
  (gen_random_uuid(),'Win the Buy Box','Competes harder on contested listings: a lower floor, faster probing, smaller moves worth making.',true,30,'BUY_BOX',7.0000,0.0150,30,0.0200,10,true),
  (gen_random_uuid(),'Clear stock','Prices to the lowest qualified competitor to move overstock and discontinued lines.',true,40,'LOWEST_PRICE',2.0000,NULL,NULL,0.0000,5,true),
  (gen_random_uuid(),'Harvest','For listings with no competitor: probe the price upward rather than defend a floor.',true,50,'BUY_BOX',25.0000,0.0250,45,0.0500,25,false),
  (gen_random_uuid(),'Hold','Evaluates and logs, never changes a price. For contract-priced or disputed listings.',true,60,'MANUAL_ONLY',12.0000,NULL,NULL,NULL,NULL,false);

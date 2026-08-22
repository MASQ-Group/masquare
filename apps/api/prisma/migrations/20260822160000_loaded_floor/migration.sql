-- Loaded-cost inputs for the floor solver.
--
-- The solver has always accepted a returns allowance, storage and ad spend, and the service never
-- supplied any of them, so every floor computed so far is a fee-and-cost breakeven. That is
-- tolerable at a 12% margin, where the omission hides inside the margin, and not tolerable at the
-- low floors an aggressive strategy runs at.
ALTER TABLE "repricing_sku_pricing"
  ADD COLUMN "returns_rate_pct" DECIMAL(6,4),
  ADD COLUMN "returns_rate_source" TEXT,
  ADD COLUMN "storage_per_unit_cents" INTEGER,
  ADD COLUMN "ad_cost_per_unit_cents" INTEGER,
  ADD COLUMN "floor_omits" TEXT[] NOT NULL DEFAULT '{}';

-- Which loaded costs a marketplace actually incurs.
--
-- Storage exists only where stock sits at Amazon, and advertising only where we advertise. Both
-- default OFF: a cost that is never incurred is not a missing input, and treating it as one blocks
-- a low-margin strategy on a floor that is already complete.
CREATE TABLE "repricing_marketplace_costs" (
  "marketplace_id"                  TEXT PRIMARY KEY,
  "storage_applies"                 BOOLEAN NOT NULL DEFAULT false,
  "ads_apply"                       BOOLEAN NOT NULL DEFAULT false,
  "default_storage_per_unit_cents"  INTEGER,
  "default_ad_cost_per_unit_cents"  INTEGER,
  "updated_at"                      TIMESTAMP(3) NOT NULL DEFAULT now()
);

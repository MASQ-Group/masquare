-- Duty and import charges on an FBA consignment.
--
-- Carriage was the only cost an inbound-to-Amazon shipment could record, so duty either went
-- unrecorded or was quietly folded into the shipping figure — which then no longer matched the
-- carrier's invoice, and made the estimate-vs-actual comparison on carriage meaningless.
--
-- Held separately and shared across the lines by the same weight share as carriage, so it reaches
-- allocated_cost_eur and from there the per-unit average that every FBA order's profit is built on.

ALTER TABLE "fba_shipment" ADD COLUMN "duty_import_eur" DECIMAL(12,2);

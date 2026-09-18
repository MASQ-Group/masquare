-- Shipment references now carry the year and month they were filed, and the number restarts each
-- January: AB-2026-09-0001, AB-2026-10-0002, then AB-2027-01-0001.
--
-- Null for every existing customer, deliberately. A customer whose counter belongs to no year has
-- their next shipment start that year's numbering at 1, which is what the old counter meant anyway
-- — references already issued keep the shape they were issued with.
ALTER TABLE "customer" ADD COLUMN "reference_year" INTEGER;

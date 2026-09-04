-- A replacement despatch is a shipment in its own right.
--
-- It has a carrier, a cost and a tracking number like any other, and it consumes a second unit of
-- stock: the first was deducted when the order originally shipped. The original sale records its
-- warehouse per line, which cannot describe the replacement, so the shipment carries its own.

ALTER TABLE "shipment" ADD COLUMN "warehouse_id" UUID;

CREATE INDEX "shipment_warehouse_id_idx" ON "shipment"("warehouse_id");

-- The warehouse may be retired later; the record of where the goods left from must outlive it.
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

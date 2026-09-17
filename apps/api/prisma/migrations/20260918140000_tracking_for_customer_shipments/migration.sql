-- Tracking serves both kinds of shipment: ours, and the ones we send for a logistics customer.
-- Exactly one of the two columns is set on any row.
ALTER TABLE "shipment_tracking" ALTER COLUMN "shipment_id" DROP NOT NULL;
ALTER TABLE "shipment_tracking" ADD COLUMN "customer_shipment_id" UUID;

CREATE UNIQUE INDEX "shipment_tracking_customer_shipment_id_key" ON "shipment_tracking"("customer_shipment_id");

ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_customer_shipment_id_fkey"
  FOREIGN KEY ("customer_shipment_id") REFERENCES "customer_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A tracking row belongs to one parcel or the other, never both and never neither. Enforced in the
-- database rather than only in the code that writes it: a row pointing at nothing would be followed
-- for ever by the sweep and shown to nobody.
ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_one_owner"
  CHECK (("shipment_id" IS NOT NULL) <> ("customer_shipment_id" IS NOT NULL));

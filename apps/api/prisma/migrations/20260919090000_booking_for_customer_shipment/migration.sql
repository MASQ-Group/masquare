-- A carrier booking can now be bought for a shipment a customer filed, not only for one of our own
-- orders. Everything about a booking — the label, the tracking number, the quoted price, the
-- cancellation — is identical whoever the parcel belongs to, so it is two nullable columns on one
-- table rather than a second table and a second copy of all of it.
--
-- Safe to relax the old NOT NULL: there are no bookings at all, on either environment, so nothing
-- had to be decided about existing rows.
ALTER TABLE "carrier_booking" ALTER COLUMN "transaction_id" DROP NOT NULL;
ALTER TABLE "carrier_booking" ADD COLUMN "customer_shipment_id" UUID;

ALTER TABLE "carrier_booking"
  ADD CONSTRAINT "carrier_booking_customer_shipment_id_fkey"
  FOREIGN KEY ("customer_shipment_id") REFERENCES "customer_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "carrier_booking_customer_shipment_id_idx" ON "carrier_booking"("customer_shipment_id");

-- Exactly one owner. Enforced here rather than by whoever writes the row next: a booking belonging
-- to both is a label charged to two shipments, and one belonging to neither is a label nobody can
-- find. Both are unrecoverable after the fact, because FedEx will not say what we shipped.
ALTER TABLE "carrier_booking"
  ADD CONSTRAINT "carrier_booking_one_owner"
  CHECK (("transaction_id" IS NOT NULL) <> ("customer_shipment_id" IS NOT NULL));

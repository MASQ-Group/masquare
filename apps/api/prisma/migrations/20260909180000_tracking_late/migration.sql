-- Arrived after the carrier's own promise.
--
-- Stored rather than computed on read: comparing two columns cannot be expressed as a query filter
-- without raw SQL, and "show me the late ones" is the question this table exists to answer.
--
-- NULL means unknown, not on time — a parcel with no promise, or none delivered, has met nothing.
ALTER TABLE "shipment_tracking" ADD COLUMN "delivered_late" BOOLEAN;

-- Backfill from what is already stored, so the filter is complete from the moment it appears rather
-- than only for parcels that happen to be re-polled later. Delivered parcels are never re-swept, so
-- without this most rows would stay null for good.
UPDATE "shipment_tracking"
   SET "delivered_late" = "delivered_at" > "estimated_delivery_at"
 WHERE "delivered_at" IS NOT NULL
   AND "estimated_delivery_at" IS NOT NULL;

CREATE INDEX "shipment_tracking_delivered_late_idx" ON "shipment_tracking"("delivered_late");

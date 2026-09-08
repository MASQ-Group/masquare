-- The rest of the carrier's reply, whole, minus the people in it.
--
-- FedEx drops a shipment's tracking history ninety days after delivery. Past that, what we stored
-- is the record — so the named columns are not enough on their own.
--
-- Redacted before it is written (see redactTrackResult): the signatory's name and both parties'
-- contact people are removed. Addresses stay; they describe where the parcel went.
ALTER TABLE "shipment_tracking" ADD COLUMN "details_json" JSONB;

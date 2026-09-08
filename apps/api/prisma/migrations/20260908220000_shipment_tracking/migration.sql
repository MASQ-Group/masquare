-- Where a parcel is, according to the carrier.
--
-- Entirely derived data: every column can be re-fetched from FedEx, and none of it is anybody's
-- entry. That is why it is a table of its own rather than columns beside the figures people typed.
CREATE TABLE "shipment_tracking" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "carrier" TEXT NOT NULL DEFAULT 'fedex',
    "tracking_number" TEXT NOT NULL,
    "status_code" TEXT,
    "status_description" TEXT,
    "delivered_at" TIMESTAMP(3),
    "estimated_delivery_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "last_scan_at" TIMESTAMP(3),
    "last_scan_description" TEXT,
    "last_scan_location" TEXT,
    "exception_code" TEXT,
    "exception_description" TEXT,
    "service_name" TEXT,
    "weight_kg" DOUBLE PRECISION,
    "shipper_reference" TEXT,
    "scans" JSONB,
    "checked_at" TIMESTAMP(3),
    "found" BOOLEAN,
    "last_error" TEXT,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_tracking_pkey" PRIMARY KEY ("id")
);

-- One row per shipment. Several shipments may share a tracking number when orders travel together;
-- each still gets its own answer, and the sweep de-duplicates numbers before calling FedEx.
CREATE UNIQUE INDEX "shipment_tracking_shipment_id_key" ON "shipment_tracking"("shipment_id");
CREATE INDEX "shipment_tracking_tracking_number_idx" ON "shipment_tracking"("tracking_number");
-- The sweep's own filter: everything not yet delivered.
CREATE INDEX "shipment_tracking_delivered_at_idx" ON "shipment_tracking"("delivered_at");

-- Cascade: tracking is a description of a shipment, and describes nothing once the shipment is gone.
ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_shipment_id_fkey"
    FOREIGN KEY ("shipment_id") REFERENCES "shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

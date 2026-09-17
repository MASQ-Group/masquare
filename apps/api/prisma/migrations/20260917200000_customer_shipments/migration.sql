-- Who is emailed when a customer files a shipment. One person, named.
ALTER TABLE "platform_settings" ADD COLUMN "logistics_alert_user_id" UUID;

-- Shipments a logistics customer asked us to send. Their own table: nothing was sold, and the
-- money runs the other way.
CREATE TABLE "customer_shipment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL,
  "reference" TEXT NOT NULL,
  "customer_reference" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "info_request" TEXT,
  "requested_date" TIMESTAMP(3),
  "goods_description" TEXT,
  "goods_value" DECIMAL(12,2),
  "goods_currency" TEXT,
  "notes" TEXT,

  "from_name" TEXT,
  "from_company" TEXT,
  "from_line1" TEXT,
  "from_line2" TEXT,
  "from_city" TEXT,
  "from_region" TEXT,
  "from_postal_code" TEXT,
  "from_country_iso" TEXT,
  "from_phone" TEXT,
  "from_email" TEXT,

  "to_name" TEXT,
  "to_company" TEXT,
  "to_line1" TEXT,
  "to_line2" TEXT,
  "to_city" TEXT,
  "to_region" TEXT,
  "to_postal_code" TEXT,
  "to_country_iso" TEXT,
  "to_phone" TEXT,
  "to_email" TEXT,

  "shipping_service_id" UUID,
  "tracking_number" TEXT,
  "shipped_at" TIMESTAMP(3),
  "fulfilled_at" TIMESTAMP(3),
  "fulfilled_by" UUID,

  "cost_cents" INTEGER,
  "charge_cents" INTEGER,
  "charge_currency" TEXT NOT NULL DEFAULT 'EUR',

  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" UUID,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customer_shipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_shipment_reference_key" ON "customer_shipment"("reference");
CREATE INDEX "customer_shipment_status_created_at_idx" ON "customer_shipment"("status", "created_at");
CREATE INDEX "customer_shipment_customer_id_status_idx" ON "customer_shipment"("customer_id", "status");

ALTER TABLE "customer_shipment" ADD CONSTRAINT "customer_shipment_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_shipment" ADD CONSTRAINT "customer_shipment_shipping_service_id_fkey"
  FOREIGN KEY ("shipping_service_id") REFERENCES "shipping_service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "customer_shipment_parcel" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shipment_id" UUID NOT NULL,
  "weight_kg" DECIMAL(10,3) NOT NULL,
  "length_cm" DECIMAL(10,1),
  "width_cm" DECIMAL(10,1),
  "height_cm" DECIMAL(10,1),
  "contents" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_shipment_parcel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_shipment_parcel_shipment_id_idx" ON "customer_shipment_parcel"("shipment_id");
ALTER TABLE "customer_shipment_parcel" ADD CONSTRAINT "customer_shipment_parcel_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "customer_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "customer_shipment_document" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shipment_id" UUID NOT NULL,
  "storage_key" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploaded_by" UUID,
  CONSTRAINT "customer_shipment_document_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_shipment_document_shipment_id_idx" ON "customer_shipment_document"("shipment_id");
ALTER TABLE "customer_shipment_document" ADD CONSTRAINT "customer_shipment_document_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "customer_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

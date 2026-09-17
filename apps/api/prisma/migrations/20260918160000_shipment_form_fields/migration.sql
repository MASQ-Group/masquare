-- The fields the customer's own shipment form asks for.

-- The order, and what is in it.
ALTER TABLE "customer_shipment" ADD COLUMN "serial_numbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The recipient, and how to reach them.
ALTER TABLE "customer_shipment" ADD COLUMN "to_line3" TEXT;
ALTER TABLE "customer_shipment" ADD COLUMN "to_vat_number" TEXT;
ALTER TABLE "customer_shipment" ADD COLUMN "delivery_instructions" TEXT;

-- Per package. `contents` becomes `goods_description`, which is what the form calls it and what
-- customs calls it; renamed rather than added beside, so there is one description per box.
ALTER TABLE "customer_shipment_parcel" RENAME COLUMN "contents" TO "goods_description";
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "customer_reference" TEXT;
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "declared_value" DECIMAL(12,2);
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "insurance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "insurance_amount" DECIMAL(12,2);
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "dangerous_goods" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "battery_type" TEXT;
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "priority_handling" BOOLEAN NOT NULL DEFAULT false;

-- A package as a customs line: quantity, country of origin, HS code. Needed for FedEx to book a
-- delivery outside the EU. Existing packages are one item each, which is what they were filed as.
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "hs_code" TEXT;
ALTER TABLE "customer_shipment_parcel" ADD COLUMN "country_of_origin" TEXT;

-- The same answers on a customer's saved product, so a package filled from one carries them.
ALTER TABLE "customer_product" ADD COLUMN "hs_code" TEXT;
ALTER TABLE "customer_product" ADD COLUMN "country_of_origin" TEXT;

-- A logistics customer's own catalogue of goods, so filing a shipment is choosing a product rather
-- than retyping its dimensions, weight and value every time.
CREATE TABLE "customer_product" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customer_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "length_cm" DECIMAL(10,1),
  "width_cm" DECIMAL(10,1),
  "height_cm" DECIMAL(10,1),
  "weight_kg" DECIMAL(10,3),
  "declared_value" DECIMAL(12,2),
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "dangerous_goods" BOOLEAN NOT NULL DEFAULT false,
  "battery_type" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" UUID,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customer_product_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_product_customer_id_name_idx" ON "customer_product"("customer_id", "name");

ALTER TABLE "customer_product" ADD CONSTRAINT "customer_product_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

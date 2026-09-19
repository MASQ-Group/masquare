-- Whether a country charges import duties and taxes on arrival, and from what value.
ALTER TABLE "country" ADD COLUMN "import_duty_mode" TEXT;
ALTER TABLE "country" ADD COLUMN "import_duty_threshold" DECIMAL(12,2);
ALTER TABLE "country" ADD COLUMN "import_duty_currency" TEXT;

-- A logistics customer's standing answer to who pays duties on their FedEx shipments.
ALTER TABLE "customer" ADD COLUMN "fedex_duties_paid_by" TEXT;

-- Rules that pre-fill who pays duties when one of our orders is booked with FedEx.
CREATE TABLE "fedex_duty_rule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sales_channel_id" UUID,
    "destination_relation" TEXT NOT NULL DEFAULT 'any',
    "destination_region" TEXT NOT NULL DEFAULT 'any',
    "duties_due" TEXT NOT NULL DEFAULT 'any',
    "duties_paid_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "fedex_duty_rule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fedex_duty_rule_sort_order_idx" ON "fedex_duty_rule"("sort_order");
ALTER TABLE "fedex_duty_rule" ADD CONSTRAINT "fedex_duty_rule_sales_channel_id_fkey"
  FOREIGN KEY ("sales_channel_id") REFERENCES "sales_channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

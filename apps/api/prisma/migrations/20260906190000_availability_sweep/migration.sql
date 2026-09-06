-- What Amazon said about listing each product on each marketplace, and the schedule that keeps asking.
--
-- Additive throughout: a new table, and five columns with defaults on a single-row settings table.
-- Nothing existing is read differently until the sweep is switched on, which is a deliberate act.

CREATE TABLE "product_channel_availability" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT '',
    "found" BOOLEAN NOT NULL,
    "asin" TEXT,
    "product_type" TEXT,
    "title" TEXT,
    "restricted" BOOLEAN,
    "restriction_reason" TEXT,
    "error" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_channel_availability_pkey" PRIMARY KEY ("id")
);

-- One current answer per product x marketplace. The upsert the sweep performs depends on this.
CREATE UNIQUE INDEX "product_channel_availability_product_id_integration_id_key"
    ON "product_channel_availability"("product_id", "integration_id");

-- The queue order: oldest answer first, within a marketplace.
CREATE INDEX "product_channel_availability_integration_id_checked_at_idx"
    ON "product_channel_availability"("integration_id", "checked_at");

CREATE INDEX "product_channel_availability_company_id_idx"
    ON "product_channel_availability"("company_id");

ALTER TABLE "product_channel_availability"
    ADD CONSTRAINT "product_channel_availability_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_channel_availability"
    ADD CONSTRAINT "product_channel_availability_integration_id_fkey"
    FOREIGN KEY ("integration_id") REFERENCES "channel_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_channel_availability"
    ADD CONSTRAINT "product_channel_availability_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The schedule. Off by default, so deploying this changes nothing until somebody turns it on.
ALTER TABLE "platform_settings"
    ADD COLUMN "availability_sweep_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "availability_sweep_batch_size" INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN "availability_sweep_interval_minutes" INTEGER NOT NULL DEFAULT 120,
    ADD COLUMN "availability_recheck_days" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "availability_sweep_last_run_at" TIMESTAMP(3);

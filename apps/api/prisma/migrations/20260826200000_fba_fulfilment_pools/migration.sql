-- Channels that share one pool of inbound stock. Amazon's Pan-European FBA is the case: stock goes
-- to one marketplace, Amazon redistributes it, and a sale arrives on a marketplace that never
-- received anything. Inbound cost is recorded per channel, so that sale found nothing and booked no
-- inbound cost — reading more profitable than it was.
CREATE TABLE "fba_fulfilment_pool" (
  "id"             UUID NOT NULL,
  "company_id"     UUID,
  "name"           TEXT NOT NULL,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "effective_from" TIMESTAMP(3),
  "effective_to"   TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "created_by"     UUID,
  "updated_by"     UUID,
  "deleted_at"     TIMESTAMP(3),
  CONSTRAINT "fba_fulfilment_pool_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fba_fulfilment_pool_company_id_idx" ON "fba_fulfilment_pool"("company_id");
ALTER TABLE "fba_fulfilment_pool"
  ADD CONSTRAINT "fba_fulfilment_pool_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A channel can receive stock, sell it, or both.
CREATE TABLE "fba_fulfilment_pool_channel" (
  "id"               UUID NOT NULL,
  "pool_id"          UUID NOT NULL,
  "sales_channel_id" UUID NOT NULL,
  "receives"         BOOLEAN NOT NULL DEFAULT false,
  "sells"            BOOLEAN NOT NULL DEFAULT true,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fba_fulfilment_pool_channel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fba_fulfilment_pool_channel_pool_id_sales_channel_id_key"
  ON "fba_fulfilment_pool_channel"("pool_id", "sales_channel_id");
CREATE INDEX "fba_fulfilment_pool_channel_sales_channel_id_idx"
  ON "fba_fulfilment_pool_channel"("sales_channel_id");
ALTER TABLE "fba_fulfilment_pool_channel"
  ADD CONSTRAINT "fba_fulfilment_pool_channel_pool_id_fkey"
  FOREIGN KEY ("pool_id") REFERENCES "fba_fulfilment_pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fba_fulfilment_pool_channel"
  ADD CONSTRAINT "fba_fulfilment_pool_channel_sales_channel_id_fkey"
  FOREIGN KEY ("sales_channel_id") REFERENCES "sales_channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

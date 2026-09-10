-- Sell-through pushes that still owe the channels a number.
--
-- The schedule used to live only in memory (a Set and an 8-second setTimeout), so a restart inside
-- that window dropped the push with no record it had ever been owed. A row here is one product's
-- outstanding debt; it is deleted the moment the push succeeds, so anything left in the table is
-- either in flight or stuck.
CREATE TABLE "channel_push_queue" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'sell_through',
    "enqueued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "channel_push_queue_pkey" PRIMARY KEY ("id")
);

-- One debt per product: a burst of orders on the same SKU coalesces instead of queueing duplicates.
CREATE UNIQUE INDEX "channel_push_queue_product_id_key" ON "channel_push_queue"("product_id");
CREATE INDEX "channel_push_queue_enqueued_at_idx" ON "channel_push_queue"("enqueued_at");

ALTER TABLE "channel_push_queue" ADD CONSTRAINT "channel_push_queue_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Whether the reconcile sweep may CORRECT what it finds rather than only report it. Off by
-- default: it writes quantities to live listings on its own judgement.
ALTER TABLE "platform_settings" ADD COLUMN "auto_correct_channel_quantity" BOOLEAN NOT NULL DEFAULT false;

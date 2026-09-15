-- One decision per order and product about availability, made once and never revisited.
CREATE TABLE "order_availability_decision" (
    "id" UUID NOT NULL,
    "order_key" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "transaction_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_availability_decision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_availability_decision_order_key_product_id_key"
    ON "order_availability_decision"("order_key", "product_id");
CREATE INDEX "order_availability_decision_product_id_idx"
    ON "order_availability_decision"("product_id");

-- Every order already in the system counts as decided. Deleted orders and lines included: an order
-- withdrawn and pulled again must not deduct a second time. Nothing here moves availability.
--
-- The key expression must match orderKey() in order-availability-rules.ts exactly.
INSERT INTO "order_availability_decision" ("id", "order_key", "product_id", "outcome", "quantity", "transaction_id", "created_at")
SELECT DISTINCT ON (k.order_key, k.product_id)
       gen_random_uuid(), k.order_key, k.product_id, 'pre_existing', 0, k.transaction_id, CURRENT_TIMESTAMP
FROM (
    SELECT
        COALESCE(t."integration_id"::text, t."sales_channel_id"::text, 'manual')
          || ':' || COALESCE(NULLIF(lower(btrim(t."transaction_ref")), ''), t."id"::text) AS order_key,
        i."product_id" AS product_id,
        t."id" AS transaction_id
    FROM "sales_transaction_item" i
    JOIN "sales_transaction" t ON t."id" = i."transaction_id"
    WHERE i."product_id" IS NOT NULL
) k
ON CONFLICT ("order_key", "product_id") DO NOTHING;
